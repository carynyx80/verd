//! Stewra — an IPO-style launchpad for AI agents on Solana.
//!
//! Lifecycle of a listing:
//!   1. `create_launch`  – creator files the listing (price range, supply, lockup).
//!   2. Roadshow         – off-chain live Q&A until `roadshow_end`.
//!   3. `place_order`    – book-building: buyers escrow SOL with a max price
//!                         between `roadshow_end` and `order_end`.
//!                         `cancel_order` refunds any time before `order_end`.
//!   4. `finalize`       – the opening bell (permissionless). One uniform
//!                         clearing price for everyone, pro-rata if
//!                         oversubscribed. Fees go to the treasury, part of
//!                         proceeds seeds a locked trading pool, the rest
//!                         goes to the creator.
//!   5. `claim`          – each buyer mints their allocation + gets refunds.
//!   6. `swap`           – trading against the built-in constant-product pool.
//!   7. `claim_creator`  – creator tokens unlock only after the lockup.
//!
//! Prices are lamports per whole token (10^DECIMALS base units). The price
//! range is split into NUM_TICKS evenly spaced price levels so the clearing
//! price can be computed on-chain in constant time.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::{create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3, Metadata};
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("3ty1t4idNWNRgVFzwoTqYKZBz2SLTaLtYv6WbGEe3nzN");

pub const DECIMALS: u8 = 6;
pub const ONE_TOKEN: u128 = 1_000_000; // 10^DECIMALS
pub const NUM_TICKS: usize = 10;
pub const BPS: u128 = 10_000;
pub const MIN_ORDER_LAMPORTS: u64 = 10_000_000; // 0.01 SOL
pub const MAX_URI_LEN: usize = 200;

#[program]
pub mod verd {
    use super::*;

    /// One-time platform setup.
    pub fn init_config(
        ctx: Context<InitConfig>,
        fee_bps: u16,
        swap_fee_bps: u16,
        min_lock_secs: i64,
    ) -> Result<()> {
        require!(fee_bps <= 1_000, VerdError::InvalidParams); // max 10%
        require!(swap_fee_bps <= 500, VerdError::InvalidParams); // max 5%
        require!(min_lock_secs >= 0, VerdError::InvalidParams);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.treasury = ctx.accounts.treasury.key();
        c.fee_bps = fee_bps;
        c.swap_fee_bps = swap_fee_bps;
        c.min_lock_secs = min_lock_secs;
        c.launch_count = 0;
        c.bump = ctx.bumps.config;
        c.paused = false;
        Ok(())
    }

    /// Emergency switch. Blocks new launches, orders, the bell and trading.
    /// Claims and order cancellations always keep working.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged { paused });
        Ok(())
    }

    /// One-time upgrade of a config account created before `paused` existed.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        let info = ctx.accounts.config.to_account_info();
        require_keys_eq!(*info.owner, crate::ID, VerdError::InvalidParams);
        let new_len = 8 + Config::INIT_SPACE;
        {
            let data = info.try_borrow_data()?;
            require!(data.len() >= 8 + 32, VerdError::InvalidParams);
            let admin = Pubkey::try_from(&data[8..40]).map_err(|_| error!(VerdError::InvalidParams))?;
            require_keys_eq!(admin, ctx.accounts.admin.key(), VerdError::Unauthorized);
            if data.len() >= new_len {
                return Ok(()); // already migrated
            }
        }
        let needed = Rent::get()?.minimum_balance(new_len).saturating_sub(info.lamports());
        if needed > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer { from: ctx.accounts.admin.to_account_info(), to: info.clone() },
                ),
                needed,
            )?;
        }
        info.resize(new_len)?;
        info.try_borrow_mut_data()?[new_len - 1] = 0; // paused = false
        Ok(())
    }

    /// Admin can tune fees / minimum lockup (cannot touch existing launches' escrow).
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_bps: u16,
        swap_fee_bps: u16,
        min_lock_secs: i64,
    ) -> Result<()> {
        require!(fee_bps <= 1_000, VerdError::InvalidParams);
        require!(swap_fee_bps <= 500, VerdError::InvalidParams);
        require!(min_lock_secs >= 0, VerdError::InvalidParams);
        let c = &mut ctx.accounts.config;
        c.fee_bps = fee_bps;
        c.swap_fee_bps = swap_fee_bps;
        c.min_lock_secs = min_lock_secs;
        c.treasury = ctx.accounts.new_treasury.key();
        Ok(())
    }

    /// File a new agent IPO.
    #[allow(clippy::too_many_arguments)]
    pub fn create_launch(
        ctx: Context<CreateLaunch>,
        launch_id: u64,
        name: String,
        symbol: String,
        sale_supply: u64,
        creator_supply: u64,
        min_price: u64,
        max_price: u64,
        lp_bps: u16,
        roadshow_secs: i64,
        order_secs: i64,
        lock_secs: i64,
        uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, VerdError::Paused);
        require!(name.len() >= 1 && name.len() <= 32, VerdError::InvalidParams);
        require!(uri.len() <= MAX_URI_LEN, VerdError::InvalidParams);
        require!(symbol.len() >= 1 && symbol.len() <= 10, VerdError::InvalidParams);
        require!(sale_supply > 0, VerdError::InvalidParams);
        // creator can keep at most 25% of the sale supply (=20% of the total float)
        require!(creator_supply <= sale_supply / 4, VerdError::CreatorShareTooHigh);
        require!(min_price > 0 && max_price >= min_price, VerdError::InvalidParams);
        require!(lp_bps >= 1_000 && lp_bps <= 5_000, VerdError::InvalidParams); // 10%-50% to liquidity
        require!(roadshow_secs >= 0 && order_secs > 0, VerdError::InvalidParams);
        let config = &mut ctx.accounts.config;
        require!(lock_secs >= config.min_lock_secs, VerdError::LockTooShort);

        let now = Clock::get()?.unix_timestamp;
        let l = &mut ctx.accounts.launch;
        l.creator = ctx.accounts.creator.key();
        l.launch_id = launch_id;
        l.mint = ctx.accounts.mint.key();
        l.name = name;
        l.symbol = symbol;
        l.sale_supply = sale_supply;
        l.creator_supply = creator_supply;
        l.min_price = min_price;
        l.max_price = max_price;
        l.lp_bps = lp_bps;
        l.fee_bps = config.fee_bps;
        l.created_at = now;
        l.roadshow_end = now.checked_add(roadshow_secs).ok_or(VerdError::MathOverflow)?;
        l.order_end = l.roadshow_end.checked_add(order_secs).ok_or(VerdError::MathOverflow)?;
        l.lock_secs = lock_secs;
        l.lock_until = 0;
        l.bucket_budget = [0; NUM_TICKS];
        l.total_budget = 0;
        l.order_count = 0;
        l.finalized = false;
        l.clearing_tick = 0;
        l.clearing_price = 0;
        l.eligible_budget = 0;
        l.sold_value = 0;
        l.tokens_sold = 0;
        l.creator_claimed = false;
        l.pool_sol = 0;
        l.pool_tokens = 0;
        l.volume_sol = 0;
        l.bump = ctx.bumps.launch;
        l.vault_bump = ctx.bumps.vault;
        l.pool_sol_bump = ctx.bumps.pool_sol_vault;
        l.mint_bump = ctx.bumps.mint;
        l.pool_tokens_bump = ctx.bumps.pool_token_account;

        // Fund both SOL PDAs with the rent-exempt minimum so they can never be
        // drained below it; balances above this seed are tracked in `launch`.
        let rent_min = Rent::get()?.minimum_balance(0);
        for to in [
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.pool_sol_vault.to_account_info(),
        ] {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.creator.to_account_info(),
                        to,
                    },
                ),
                rent_min,
            )?;
        }

        // Register name, ticker and logo URI so wallets display the token.
        // The launch PDA is mint and update authority; nobody else can change it.
        let creator_key = ctx.accounts.creator.key();
        let id_bytes = launch_id.to_le_bytes();
        let launch_seeds: &[&[u8]] = &[b"launch", creator_key.as_ref(), &id_bytes, &[ctx.bumps.launch]];
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.launch.to_account_info(),
                    payer: ctx.accounts.creator.to_account_info(),
                    update_authority: ctx.accounts.launch.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                &[launch_seeds],
            ),
            DataV2 {
                name: ctx.accounts.launch.name.clone(),
                symbol: ctx.accounts.launch.symbol.clone(),
                uri,
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true,
            true,
            None,
        )?;

        config.launch_count = config.launch_count.saturating_add(1);
        let l = &ctx.accounts.launch;
        emit!(LaunchCreated {
            launch: l.key(),
            creator: l.creator,
            mint: l.mint,
        });
        Ok(())
    }

    /// Book-building: escrow SOL with a maximum acceptable price (as a tick index).
    pub fn place_order(ctx: Context<PlaceOrder>, budget: u64, max_tick: u8) -> Result<()> {
        require!(!ctx.accounts.config.paused, VerdError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let l = &mut ctx.accounts.launch;
        require!(!l.finalized, VerdError::AlreadyFinalized);
        require!(now >= l.roadshow_end, VerdError::BookNotOpen);
        require!(now < l.order_end, VerdError::BookClosed);
        require!(budget >= MIN_ORDER_LAMPORTS, VerdError::OrderTooSmall);
        require!((max_tick as usize) < NUM_TICKS, VerdError::InvalidParams);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            budget,
        )?;

        let i = max_tick as usize;
        l.bucket_budget[i] = l.bucket_budget[i].checked_add(budget).ok_or(VerdError::MathOverflow)?;
        l.total_budget = l.total_budget.checked_add(budget).ok_or(VerdError::MathOverflow)?;
        l.order_count = l.order_count.saturating_add(1);

        let o = &mut ctx.accounts.order;
        o.buyer = ctx.accounts.buyer.key();
        o.launch = l.key();
        o.budget = budget;
        o.max_tick = max_tick;
        o.placed_at = now;
        o.bump = ctx.bumps.order;

        emit!(OrderPlaced {
            launch: l.key(),
            buyer: o.buyer,
            budget,
            max_price: tick_price(l.min_price, l.max_price, max_tick)?,
        });
        Ok(())
    }

    /// Withdraw an order before the book closes. Full refund, order account closed.
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let launch_key = ctx.accounts.launch.key();
        let l = &mut ctx.accounts.launch;
        require!(!l.finalized, VerdError::AlreadyFinalized);
        require!(now < l.order_end, VerdError::BookClosed);
        let o = &ctx.accounts.order;
        let i = o.max_tick as usize;
        l.bucket_budget[i] = l.bucket_budget[i].checked_sub(o.budget).ok_or(VerdError::MathOverflow)?;
        l.total_budget = l.total_budget.checked_sub(o.budget).ok_or(VerdError::MathOverflow)?;
        l.order_count = l.order_count.saturating_sub(1);

        let seeds: &[&[u8]] = &[b"vault", launch_key.as_ref(), &[l.vault_bump]];
        pay_from_pda(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.buyer.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            seeds,
            o.budget,
        )?;
        Ok(())
    }

    /// The opening bell. Anyone can ring it once the book has closed.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        require!(!ctx.accounts.config.paused, VerdError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let launch_key = ctx.accounts.launch.key();
        let l = &mut ctx.accounts.launch;
        require!(!l.finalized, VerdError::AlreadyFinalized);
        require!(now >= l.order_end, VerdError::BookStillOpen);

        let outcome = compute_clearing(
            &l.bucket_budget,
            l.min_price,
            l.max_price,
            l.sale_supply,
            l.total_budget,
        )?;
        l.finalized = true;
        l.clearing_tick = outcome.tick;
        l.clearing_price = outcome.price;
        l.eligible_budget = outcome.eligible_budget;
        l.sold_value = outcome.sold_value;
        l.tokens_sold = outcome.tokens_sold;
        l.lock_until = now.checked_add(l.lock_secs).ok_or(VerdError::MathOverflow)?;

        if outcome.sold_value > 0 {
            let proceeds = outcome.sold_value as u128;
            let fee = (proceeds * l.fee_bps as u128 / BPS) as u64;
            let lp_sol = (proceeds * l.lp_bps as u128 / BPS) as u64;
            let to_creator = outcome
                .sold_value
                .checked_sub(fee)
                .and_then(|v| v.checked_sub(lp_sol))
                .ok_or(VerdError::MathOverflow)?;
            let lp_tokens = (lp_sol as u128 * ONE_TOKEN / outcome.price as u128) as u64;

            let vault_seeds: &[&[u8]] = &[b"vault", launch_key.as_ref(), &[l.vault_bump]];
            let vault = ctx.accounts.vault.to_account_info();
            let sys = ctx.accounts.system_program.to_account_info();
            pay_from_pda(&vault, &ctx.accounts.treasury.to_account_info(), &sys, vault_seeds, fee)?;
            pay_from_pda(&vault, &ctx.accounts.pool_sol_vault.to_account_info(), &sys, vault_seeds, lp_sol)?;
            pay_from_pda(&vault, &ctx.accounts.creator.to_account_info(), &sys, vault_seeds, to_creator)?;

            // Seed the pool at exactly the clearing price. Liquidity is locked
            // forever: the program has no instruction to withdraw it.
            let creator_key = l.creator;
            let id_bytes = l.launch_id.to_le_bytes();
            let launch_seeds: &[&[u8]] = &[b"launch", creator_key.as_ref(), &id_bytes, &[l.bump]];
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.pool_token_account.to_account_info(),
                        authority: l.to_account_info(),
                    },
                    &[launch_seeds],
                ),
                lp_tokens,
            )?;
            l.pool_sol = lp_sol;
            l.pool_tokens = lp_tokens;
        }

        emit!(BellRung {
            launch: launch_key,
            clearing_price: outcome.price,
            tokens_sold: outcome.tokens_sold,
            raised: outcome.sold_value,
        });
        Ok(())
    }

    /// Buyer collects their allocation and any refund. Order account is closed.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let launch_key = ctx.accounts.launch.key();
        let l = &ctx.accounts.launch;
        require!(l.finalized, VerdError::NotFinalized);
        let o = &ctx.accounts.order;

        let (spent, tokens) = allocation(o.budget, o.max_tick, l)?;
        let refund = o.budget.checked_sub(spent).ok_or(VerdError::MathOverflow)?;

        if tokens > 0 {
            let creator_key = l.creator;
            let id_bytes = l.launch_id.to_le_bytes();
            let launch_seeds: &[&[u8]] = &[b"launch", creator_key.as_ref(), &id_bytes, &[l.bump]];
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ctx.accounts.buyer_token_account.to_account_info(),
                        authority: ctx.accounts.launch.to_account_info(),
                    },
                    &[launch_seeds],
                ),
                tokens,
            )?;
        }
        if refund > 0 {
            let seeds: &[&[u8]] = &[b"vault", launch_key.as_ref(), &[l.vault_bump]];
            pay_from_pda(
                &ctx.accounts.vault.to_account_info(),
                &ctx.accounts.buyer.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                seeds,
                refund,
            )?;
        }
        emit!(Claimed { launch: launch_key, buyer: o.buyer, tokens, refund });
        Ok(())
    }

    /// Creator allocation, only after the lockup has passed.
    pub fn claim_creator(ctx: Context<ClaimCreator>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let l = &mut ctx.accounts.launch;
        require!(l.finalized, VerdError::NotFinalized);
        require!(!l.creator_claimed, VerdError::AlreadyClaimed);
        require!(now >= l.lock_until, VerdError::StillLocked);
        require!(l.tokens_sold > 0, VerdError::NothingToClaim);
        // If the sale was undersubscribed, creator share scales down with it.
        let amount = (l.creator_supply as u128 * l.tokens_sold as u128 / l.sale_supply as u128) as u64;
        l.creator_claimed = true;

        let creator_key = l.creator;
        let id_bytes = l.launch_id.to_le_bytes();
        let launch_seeds: &[&[u8]] = &[b"launch", creator_key.as_ref(), &id_bytes, &[l.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: l.to_account_info(),
                },
                &[launch_seeds],
            ),
            amount,
        )?;
        Ok(())
    }

    /// Trade against the launch's locked constant-product pool.
    /// `buy = true`: amount_in is lamports, output is tokens.
    /// `buy = false`: amount_in is token base units, output is lamports.
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_out: u64, buy: bool) -> Result<()> {
        let launch_key = ctx.accounts.launch.key();
        let swap_fee_bps = ctx.accounts.config.swap_fee_bps as u128;
        let l = &mut ctx.accounts.launch;
        require!(!ctx.accounts.config.paused, VerdError::Paused);
        require!(l.finalized, VerdError::NotFinalized);
        require!(l.pool_sol > 0 && l.pool_tokens > 0, VerdError::PoolEmpty);
        require!(amount_in > 0, VerdError::InvalidParams);

        let sys = ctx.accounts.system_program.to_account_info();
        let q = swap_quote(l.pool_sol, l.pool_tokens, amount_in, swap_fee_bps as u64, buy)?;

        if buy {
            let (net, out, fee) = (q.pool_delta, q.out, q.fee);
            require!(out >= min_out, VerdError::Slippage);

            system_program::transfer(
                CpiContext::new(sys.clone(), system_program::Transfer {
                    from: ctx.accounts.trader.to_account_info(),
                    to: ctx.accounts.pool_sol_vault.to_account_info(),
                }),
                net,
            )?;
            if fee > 0 {
                system_program::transfer(
                    CpiContext::new(sys.clone(), system_program::Transfer {
                        from: ctx.accounts.trader.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    }),
                    fee,
                )?;
            }
            let creator_key = l.creator;
            let id_bytes = l.launch_id.to_le_bytes();
            let launch_seeds: &[&[u8]] = &[b"launch", creator_key.as_ref(), &id_bytes, &[l.bump]];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.pool_token_account.to_account_info(),
                        to: ctx.accounts.trader_token_account.to_account_info(),
                        authority: l.to_account_info(),
                    },
                    &[launch_seeds],
                ),
                out,
            )?;
            l.pool_sol = l.pool_sol.checked_add(net).ok_or(VerdError::MathOverflow)?;
            l.pool_tokens -= out;
            l.volume_sol = l.volume_sol.saturating_add(amount_in);
            emit!(Swapped { launch: launch_key, trader: ctx.accounts.trader.key(), buy, amount_in, amount_out: out });
        } else {
            let (gross, out, fee) = (q.pool_delta, q.out, q.fee);
            require!(out >= min_out, VerdError::Slippage);

            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.trader_token_account.to_account_info(),
                        to: ctx.accounts.pool_token_account.to_account_info(),
                        authority: ctx.accounts.trader.to_account_info(),
                    },
                ),
                amount_in,
            )?;
            let seeds: &[&[u8]] = &[b"pool_sol", launch_key.as_ref(), &[l.pool_sol_bump]];
            let pool = ctx.accounts.pool_sol_vault.to_account_info();
            pay_from_pda(&pool, &ctx.accounts.trader.to_account_info(), &sys, seeds, out)?;
            if fee > 0 {
                pay_from_pda(&pool, &ctx.accounts.treasury.to_account_info(), &sys, seeds, fee)?;
            }
            l.pool_sol -= gross;
            l.pool_tokens = l.pool_tokens.checked_add(amount_in).ok_or(VerdError::MathOverflow)?;
            l.volume_sol = l.volume_sol.saturating_add(gross);
            emit!(Swapped { launch: launch_key, trader: ctx.accounts.trader.key(), buy, amount_in, amount_out: out });
        }
        Ok(())
    }
}

// ───────────────────────── math ─────────────────────────

pub fn tick_price(min_price: u64, max_price: u64, tick: u8) -> Result<u64> {
    let span = (max_price - min_price) as u128;
    let p = min_price as u128 + span * tick as u128 / (NUM_TICKS as u128 - 1);
    u64::try_from(p).map_err(|_| error!(VerdError::MathOverflow))
}

pub struct Clearing {
    pub tick: u8,
    pub price: u64,
    pub eligible_budget: u64,
    pub sold_value: u64,
    pub tokens_sold: u64,
}

/// Uniform-price auction over the tick grid. Finds the highest price at which
/// demand covers the full sale supply. If even the lowest price can't sell
/// everything, all orders fill completely at the minimum price.
pub fn compute_clearing(
    buckets: &[u64; NUM_TICKS],
    min_price: u64,
    max_price: u64,
    sale_supply: u64,
    total_budget: u64,
) -> Result<Clearing> {
    let mut cum: u128 = 0;
    for k in (0..NUM_TICKS).rev() {
        cum += buckets[k] as u128;
        let price = tick_price(min_price, max_price, k as u8)?;
        let demand_tokens = cum * ONE_TOKEN / price as u128;
        if demand_tokens >= sale_supply as u128 {
            let sold_value = (sale_supply as u128 * price as u128).div_ceil(ONE_TOKEN);
            let sold_value = sold_value.min(cum); // guard rounding
            return Ok(Clearing {
                tick: k as u8,
                price,
                eligible_budget: cum as u64,
                sold_value: sold_value as u64,
                tokens_sold: sale_supply,
            });
        }
    }
    // Undersubscribed: everyone fills fully at the minimum price.
    let tokens = (total_budget as u128 * ONE_TOKEN / min_price as u128) as u64;
    Ok(Clearing {
        tick: 0,
        price: min_price,
        eligible_budget: total_budget,
        sold_value: total_budget,
        tokens_sold: tokens,
    })
}

/// (lamports spent, tokens received) for one order after the bell.
/// Spend is rounded *up* so the vault always holds enough for every refund.
pub fn allocation(budget: u64, max_tick: u8, l: &Launch) -> Result<(u64, u64)> {
    if l.sold_value == 0 || max_tick < l.clearing_tick || l.eligible_budget == 0 {
        return Ok((0, 0));
    }
    let spent = (budget as u128 * l.sold_value as u128).div_ceil(l.eligible_budget as u128);
    let spent = spent.min(budget as u128);
    let tokens = spent * ONE_TOKEN / l.clearing_price as u128;
    Ok((spent as u64, tokens as u64))
}

pub struct SwapQuote {
    /// buy: lamports added to the pool; sell: lamports taken from the pool (before fee)
    pub pool_delta: u64,
    /// buy: tokens out; sell: lamports to the trader after fee
    pub out: u64,
    /// lamports to the treasury
    pub fee: u64,
}

/// Constant-product quote with the protocol fee taken in SOL on both sides.
pub fn swap_quote(pool_sol: u64, pool_tokens: u64, amount_in: u64, fee_bps: u64, buy: bool) -> Result<SwapQuote> {
    let x = pool_sol as u128;
    let y = pool_tokens as u128;
    require!(x > 0 && y > 0, VerdError::PoolEmpty);
    require!(amount_in > 0, VerdError::InvalidParams);
    if buy {
        let fee = (amount_in as u128 * fee_bps as u128 / BPS) as u64;
        let net = amount_in - fee;
        let out = y * net as u128 / (x + net as u128);
        require!(out > 0 && out < y, VerdError::PoolEmpty);
        Ok(SwapQuote { pool_delta: net, out: out as u64, fee })
    } else {
        let gross = x * amount_in as u128 / (y + amount_in as u128);
        require!(gross > 0 && gross < x, VerdError::PoolEmpty);
        let fee = (gross * fee_bps as u128 / BPS) as u64;
        Ok(SwapQuote { pool_delta: gross as u64, out: gross as u64 - fee, fee })
    }
}

fn pay_from_pda<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system: &AccountInfo<'info>,
    seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    system_program::transfer(
        CpiContext::new_with_signer(
            system.clone(),
            system_program::Transfer { from: from.clone(), to: to.clone() },
            &[seeds],
        ),
        amount,
    )
}

// ───────────────────────── accounts ─────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub swap_fee_bps: u16,
    pub min_lock_secs: i64,
    pub launch_count: u64,
    pub bump: u8,
    pub paused: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Launch {
    pub creator: Pubkey,
    pub launch_id: u64,
    pub mint: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    pub sale_supply: u64,
    pub creator_supply: u64,
    pub min_price: u64,
    pub max_price: u64,
    pub lp_bps: u16,
    pub fee_bps: u16,
    pub created_at: i64,
    pub roadshow_end: i64,
    pub order_end: i64,
    pub lock_secs: i64,
    pub lock_until: i64,
    pub bucket_budget: [u64; NUM_TICKS],
    pub total_budget: u64,
    pub order_count: u32,
    pub finalized: bool,
    pub clearing_tick: u8,
    pub clearing_price: u64,
    pub eligible_budget: u64,
    pub sold_value: u64,
    pub tokens_sold: u64,
    pub creator_claimed: bool,
    pub pool_sol: u64,
    pub pool_tokens: u64,
    pub volume_sol: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub pool_sol_bump: u8,
    pub mint_bump: u8,
    pub pool_tokens_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub buyer: Pubkey,
    pub launch: Pubkey,
    pub budget: u64,
    pub max_tick: u8,
    pub placed_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: any system account can receive fees
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
    /// CHECK: any system account can receive fees
    pub new_treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// CHECK: old-layout config; owner and admin are verified by hand in the handler
    #[account(mut, seeds = [b"config"], bump)]
    pub config: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(launch_id: u64)]
pub struct CreateLaunch<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = creator,
        space = 8 + Launch::INIT_SPACE,
        seeds = [b"launch", creator.key().as_ref(), &launch_id.to_le_bytes()],
        bump
    )]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        init,
        payer = creator,
        seeds = [b"mint", launch.key().as_ref()],
        bump,
        mint::decimals = DECIMALS,
        mint::authority = launch,
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        seeds = [b"pool_tokens", launch.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = launch,
    )]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"vault", launch.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"pool_sol", launch.key().as_ref()], bump)]
    pub pool_sol_vault: SystemAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: created by the Metaplex token metadata program; address is checked by seeds
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        seeds::program = token_metadata_program.key(),
        bump
    )]
    pub metadata: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", launch.key().as_ref(), buyer.key().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    #[account(mut, seeds = [b"vault", launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"order", launch.key().as_ref(), buyer.key().as_ref()],
        bump = order.bump,
        has_one = buyer,
        has_one = launch,
    )]
    pub order: Account<'info, Order>,
    #[account(mut, seeds = [b"vault", launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = creator, has_one = mint)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(mut, seeds = [b"mint", launch.key().as_ref()], bump = launch.mint_bump)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"pool_tokens", launch.key().as_ref()], bump = launch.pool_tokens_bump)]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"vault", launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut, seeds = [b"pool_sol", launch.key().as_ref()], bump = launch.pool_sol_bump)]
    pub pool_sol_vault: SystemAccount<'info>,
    /// CHECK: verified against launch.creator via has_one
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: verified against config.treasury via has_one
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// Anyone can ring the bell.
    pub caller: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(has_one = mint)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"order", launch.key().as_ref(), buyer.key().as_ref()],
        bump = order.bump,
        has_one = buyer,
        has_one = launch,
    )]
    pub order: Account<'info, Order>,
    #[account(mut, seeds = [b"mint", launch.key().as_ref()], bump = launch.mint_bump)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"vault", launch.key().as_ref()], bump = launch.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimCreator<'info> {
    #[account(mut, has_one = creator, has_one = mint)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(mut, seeds = [b"mint", launch.key().as_ref()], bump = launch.mint_bump)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = mint)]
    pub launch: Box<Account<'info, Launch>>,
    #[account(seeds = [b"mint", launch.key().as_ref()], bump = launch.mint_bump)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"pool_tokens", launch.key().as_ref()], bump = launch.pool_tokens_bump)]
    pub pool_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"pool_sol", launch.key().as_ref()], bump = launch.pool_sol_bump)]
    pub pool_sol_vault: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader,
    )]
    pub trader_token_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: verified against config.treasury via has_one
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub trader: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ───────────────────────── events & errors ─────────────────────────

#[event]
pub struct PauseChanged { pub paused: bool }
#[event]
pub struct LaunchCreated { pub launch: Pubkey, pub creator: Pubkey, pub mint: Pubkey }
#[event]
pub struct OrderPlaced { pub launch: Pubkey, pub buyer: Pubkey, pub budget: u64, pub max_price: u64 }
#[event]
pub struct BellRung { pub launch: Pubkey, pub clearing_price: u64, pub tokens_sold: u64, pub raised: u64 }
#[event]
pub struct Claimed { pub launch: Pubkey, pub buyer: Pubkey, pub tokens: u64, pub refund: u64 }
#[event]
pub struct Swapped { pub launch: Pubkey, pub trader: Pubkey, pub buy: bool, pub amount_in: u64, pub amount_out: u64 }

#[error_code]
pub enum VerdError {
    #[msg("Invalid parameters")]
    InvalidParams,
    #[msg("Creator allocation cannot exceed 25% of the sale supply")]
    CreatorShareTooHigh,
    #[msg("Creator lockup is shorter than the platform minimum")]
    LockTooShort,
    #[msg("The order book is not open yet (roadshow in progress)")]
    BookNotOpen,
    #[msg("The order book is closed")]
    BookClosed,
    #[msg("The order book is still open")]
    BookStillOpen,
    #[msg("Order below the 0.01 SOL minimum")]
    OrderTooSmall,
    #[msg("Launch already finalized")]
    AlreadyFinalized,
    #[msg("Launch not finalized yet")]
    NotFinalized,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Creator tokens are still locked")]
    StillLocked,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Pool is empty")]
    PoolEmpty,
    #[msg("Price moved beyond your slippage limit")]
    Slippage,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Stewra is paused for maintenance. Claims and refunds still work.")]
    Paused,
    #[msg("Not authorized")]
    Unauthorized,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversubscribed_clears_at_max_pro_rata() {
        // supply 1000 tokens, range 0.1–1.0 SOL; 2000 SOL all at the top tick
        let mut b = [0u64; NUM_TICKS];
        b[9] = 2_000_000_000_000;
        let c = compute_clearing(&b, 100_000_000, 1_000_000_000, 1000 * ONE_TOKEN as u64, b[9]).unwrap();
        assert_eq!(c.tick, 9);
        assert_eq!(c.price, 1_000_000_000);
        assert_eq!(c.sold_value, 1_000_000_000_000);
        assert_eq!(c.tokens_sold, 1000 * ONE_TOKEN as u64);
    }

    #[test]
    fn clears_at_highest_covering_tick() {
        // 100 tokens; 50 SOL willing up to max (1 SOL), 50 SOL only at min (0.1)
        let mut b = [0u64; NUM_TICKS];
        b[9] = 50_000_000_000;
        b[0] = 50_000_000_000;
        let c = compute_clearing(&b, 100_000_000, 1_000_000_000, 100 * ONE_TOKEN as u64, 100_000_000_000).unwrap();
        // at max price demand = 50 tokens < 100; ticks 8..1 same cum => demand rises as price falls
        // tick k price = 0.1 + 0.1k SOL; demand = 50/price >= 100 needs price <= 0.5 => k=4
        assert_eq!(c.tick, 4);
        assert_eq!(c.price, 500_000_000);
        assert_eq!(c.eligible_budget, 50_000_000_000);
    }

    #[test]
    fn undersubscribed_fills_everyone_at_min() {
        let mut b = [0u64; NUM_TICKS];
        b[3] = 1_000_000_000;
        let c = compute_clearing(&b, 100_000_000, 1_000_000_000, 1_000_000 * ONE_TOKEN as u64, b[3]).unwrap();
        assert_eq!(c.price, 100_000_000);
        assert_eq!(c.sold_value, 1_000_000_000);
        assert_eq!(c.tokens_sold, 10 * ONE_TOKEN as u64);
    }
}

#[cfg(test)]
mod properties {
    use super::*;
    use proptest::prelude::*;

    fn launch_after(buckets: [u64; NUM_TICKS], total: u64, min: u64, max: u64, supply: u64) -> Launch {
        let c = compute_clearing(&buckets, min, max, supply, total).unwrap();
        Launch {
            creator: Pubkey::default(), launch_id: 0, mint: Pubkey::default(),
            name: String::new(), symbol: String::new(),
            sale_supply: supply, creator_supply: 0, min_price: min, max_price: max,
            lp_bps: 3000, fee_bps: 200, created_at: 0, roadshow_end: 0, order_end: 0,
            lock_secs: 0, lock_until: 0, bucket_budget: buckets, total_budget: total,
            order_count: 0, finalized: true, clearing_tick: c.tick, clearing_price: c.price,
            eligible_budget: c.eligible_budget, sold_value: c.sold_value, tokens_sold: c.tokens_sold,
            creator_claimed: false, pool_sol: 0, pool_tokens: 0, volume_sol: 0,
            bump: 0, vault_bump: 0, pool_sol_bump: 0, mint_bump: 0, pool_tokens_bump: 0,
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(4000))]

        /// For any set of orders: the vault can pay every refund, nobody pays more
        /// than they put in or above their max price, and the price stays in range.
        #[test]
        fn auction_is_solvent_and_fair(
            orders in prop::collection::vec((MIN_ORDER_LAMPORTS..200_000_000_000u64, 0u8..NUM_TICKS as u8), 1..60),
            min in 1_000u64..10_000_000,
            spread in 0u64..100_000_000,
            supply_tokens in 1u64..10_000_000,
        ) {
            let max = min + spread;
            let supply = supply_tokens * ONE_TOKEN as u64;
            let mut buckets = [0u64; NUM_TICKS];
            let mut total = 0u64;
            for (b, t) in &orders { buckets[*t as usize] += b; total += b; }
            let l = launch_after(buckets, total, min, max, supply);

            prop_assert!(l.clearing_price >= min && l.clearing_price <= max);
            prop_assert!(l.sold_value <= total);

            let mut spent_sum: u128 = 0;
            let mut tokens_sum: u128 = 0;
            for (b, t) in &orders {
                let (spent, toks) = allocation(*b, *t, &l).unwrap();
                prop_assert!(spent <= *b, "paid more than budget");
                if *t < l.clearing_tick { prop_assert_eq!(spent, 0); prop_assert_eq!(toks, 0); }
                if toks > 0 {
                    let max_ok = tick_price(min, max, *t).unwrap() as u128;
                    // effective price never exceeds the buyer's limit (allow 1 base unit rounding)
                    prop_assert!(spent as u128 * ONE_TOKEN <= max_ok * (toks as u128 + 1));
                }
                spent_sum += spent as u128;
                tokens_sum += toks as u128;
            }
            // Solvency: what leaves the vault at the bell plus all refunds never exceeds deposits.
            prop_assert!(spent_sum >= l.sold_value as u128, "refunds would exceed vault");
            // Rounding up spend may hand out at most ~1 lamport worth of tokens extra per order.
            let slack = orders.len() as u128 * (ONE_TOKEN / l.clearing_price as u128 + 1);
            prop_assert!(tokens_sum <= l.tokens_sold as u128 + slack);
        }

        /// Trading never lets the pool be drained or its value (x*y) shrink.
        #[test]
        fn pool_invariant_holds(
            pool_sol in 1_000_000u64..1_000_000_000_000,
            pool_tokens in 1_000_000u64..1_000_000_000_000_000,
            trades in prop::collection::vec((1u64..10_000_000_000_000, any::<bool>()), 1..40),
            fee_bps in 0u64..500,
        ) {
            let (mut x, mut y) = (pool_sol, pool_tokens);
            for (amt, buy) in trades {
                let k_before = x as u128 * y as u128;
                let amt = if buy { amt } else { amt % (y.saturating_mul(4) + 1) + 1 };
                if let Ok(q) = swap_quote(x, y, amt, fee_bps, buy) {
                    if buy { x += q.pool_delta; y -= q.out; } else { x -= q.pool_delta; y += amt; }
                    prop_assert!(x > 0 && y > 0, "pool drained");
                    prop_assert!(x as u128 * y as u128 >= k_before, "k decreased");
                    if buy {
                        prop_assert_eq!(q.pool_delta + q.fee, amt, "buy: SOL in must equal pool + fee");
                    } else {
                        prop_assert_eq!(q.out + q.fee, q.pool_delta, "sell: SOL out + fee must equal what left the pool");
                    }
                }
            }
        }
    }
}
