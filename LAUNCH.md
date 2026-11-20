# Stewra mainnet runbook (company-wallet edition)

Stewra runs on Solana mainnet **without deploying its own program**. It uses only programs that already exist on mainnet:

| Need | Program (same address on mainnet and devnet) |
|---|---|
| Tokens | SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Name, ticker, logo in wallets | Metaplex Token Metadata `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` |
| Order attribution | Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` |
| Trading + locked liquidity | Meteora DAMM v2 `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` |

All four were checked as live, executable programs on mainnet on 2026-11-20.

Company wallet: `jdceA46wcDNdk2SSZoZTz3MWdM95n94Fh8EXPQQrR21` (valid address, on the ed25519 curve, so it's a normal wallet you hold the key for; it has no SOL on mainnet yet).

## What changed versus the program design

| Feature | Before (custom program) | Now |
|---|---|---|
| Order escrow | Program vault, trustless | **Company wallet, custodial** |
| Clearing price | Computed on-chain | Computed by the server (same maths, unit-tested) |
| Refunds, allocations | Buyer claims from the program | Sent by the company wallet automatically |
| Who rings the bell | Anyone | The server, ~45s after the book closes |
| Token supply | Program-controlled mint | Company holds mint authority until the bell, then **revokes it** (fixed supply, checkable on-chain) |
| Locked liquidity | Program pool with no withdraw | Meteora pool, position **permanently locked** on-chain |
| Trading | Program swap | Wallet ↔ Meteora pool directly (non-custodial) |
| Creator lockup | Program-enforced | Company holds the tokens, releases them at unlock |
| Emergency pause | Program flag | Server flag in `/admin` or `PAYOUTS_PAUSED=1` |

### Still needs a custom program (cannot be replicated safely without one)
- **Trustless escrow.** Only a program can hold buyers' SOL so that nobody, including Stewra, can move it except by the sale rules. With a company wallet, buyers must trust Stewra.
- **Trustless clearing and settlement.** Anyone can recompute the price from the public deposits and the ledger, but only a program could *force* the payouts.
- **Trustless creator lockup.** Today the company holds the creator's tokens. A vesting program could lock them without trust.

The program in `programs/verd` does all three and is ready for an audit and the ~2.3 SOL deploy when you want to go non-custodial.

## Environment variables

### Railway (backend, `verd-server`)

| Variable | Value | Required |
|---|---|---|
| `SOLANA_NETWORK` | `mainnet-beta` | yes |
| `RPC_URL` | Paid mainnet RPC URL (Helius, Triton, QuickNode) | yes |
| `COMPANY_WALLET_ADDRESS` | `jdceA46wcDNdk2SSZoZTz3MWdM95n94Fh8EXPQQrR21` | yes |
| `ADMIN_WALLETS` | `jdceA46wcDNdk2SSZoZTz3MWdM95n94Fh8EXPQQrR21` plus any moderator wallets | yes |
| `PUBLIC_API_URL` | The Railway public URL (used in token metadata links) | yes |
| `SITE_URL` | Your site URL | yes |
| `CORS_ORIGINS` | Your site URL(s), comma-separated | yes |
| `DATA_DIR` | `/data` (the Railway volume) | yes |
| `ANTHROPIC_API_KEY` | Claude key for the roadshow | for Q&A |
| `MIN_LOCK_SECS` | `7776000` (90 days) | default |
| `FEE_BPS` / `SWAP_FEE_BPS` | `200` / `100` | default |
| `LISTING_FEE_LAMPORTS` | `50000000` (0.05 SOL) | default |
| `MAX_ORDER_LAMPORTS` | per-order cap, default 100 SOL | optional |
| `TREASURY_ADDRESS` | if fees should go to a different wallet | optional |
| `COMPANY_WALLET_SECRET` | **leave unset** (see below) | optional |
| `PAYOUTS_PAUSED` | `1` to hard-stop everything | optional |

Remove the old `PROGRAM_ID` variable.

### Vercel (frontend, `verd`)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SOLANA_NETWORK` | `mainnet-beta` |
| `NEXT_PUBLIC_RPC_URL` | Paid mainnet RPC URL (a separate, browser-restricted key if your provider supports it) |
| `NEXT_PUBLIC_API_URL` | The Railway public URL |
| `NEXT_PUBLIC_COMPANY_WALLET_ADDRESS` | `jdceA46wcDNdk2SSZoZTz3MWdM95n94Fh8EXPQQrR21` |

Remove `NEXT_PUBLIC_CLUSTER` and `NEXT_PUBLIC_PROGRAM_ID`. If the server and the site ever disagree on the company wallet, the site refuses to send orders.

## Operating the company wallet (security requirements)

**Payout mode.** By default the server has **no private key**. It builds every payout; you open `/admin` with the company wallet connected, press **Sign & send**, and approve in your wallet. The server broadcasts only the exact transaction it built, and only once. This is the recommended setup.

Optional automatic mode: set `COMPANY_WALLET_SECRET` on Railway. It's ignored unless it belongs to the company wallet. Even then, payouts over `AUTO_PAYOUT_MAX_LAMPORTS` (5 SOL) and anything past `AUTO_DAILY_MAX_LAMPORTS` (50 SOL per 24h) still need your signature. If you turn this on, anyone who gets into Railway can take the hot balance, so:
- use a separate hot wallet for automation and move surplus out regularly, rather than putting your main wallet's key on a server, or keep automation off;
- turn on 2FA for Railway, GitHub and Vercel, and limit who has access.

Always:
- Use a **hardware wallet** (Ledger) for the company wallet. Never type its seed phrase into any website, chat or server. Stewra never asks for it.
- Keep the company wallet for Stewra only, so the ledger and the balance reconcile.
- Watch **Surplus** in `/admin` (balance minus what's owed to users). It must never go negative. Don't withdraw below what's owed.
- Keep about **0.2 SOL** of operating balance for transaction fees, pool rent and token accounts.
- Use **Emergency pause** in `/admin` if anything looks wrong. While paused: deposits are still recorded, nothing else moves.
- Download the ledger and state regularly (`/admin` → backup, plus `ledger.jsonl` on the volume).
- Payout signing: process the queue at least daily, and soon after every bell. Users see "queued" until you sign.
- Deposits without a Stewra memo appear under **Deposits without a Stewra order**. They're never credited; refund them by hand.

## Costs

| Item | Cost | Who pays |
|---|---|---|
| Program deploy | **0** (no custom program) | — |
| Filing a listing | ~0.007 SOL rent + 0.05 SOL listing fee | creator |
| Per listing, from the company wallet | ~0.023 SOL (pool accounts, token accounts, fees), measured on devnet | covered by the listing fee |
| Per winning buyer | ~0.002 SOL token account rent | company wallet (covered by the 2% fee on most orders) |
| Each payout transaction | ~0.000005 SOL + priority fee | company wallet |
| Paid RPC | ~$50–100/month | you |
| Railway + Vercel | current plans | you |
| Claude API | per use | you |
| Domain | ~$10–30/year | you |
| Legal review of custodial model | varies | you |

## Go-live checklist

Done and verified (2026-11-20):
- [x] Company wallet address validated
- [x] All four mainnet programs exist
- [x] Server unit tests: 14/14 (deposits, refunds, dedupe, cancel, bell maths, accounting, admin auth, signature checks)
- [x] Devnet end-to-end, both payout modes, all checks pass: filing, finalized-only crediting, duplicate reports ignored, refused order auto-refunded, signed cancel, forged cancel rejected, bell at the right price, allocation and refunds, mint authority revoked, locked Meteora pool, buy and sell, creator release after lockup, zero owed and positive surplus at the end, complete ledger
- [x] Frontend production build passes; pages checked in the browser against a devnet backend

You (or Claude, with your approval):
- [ ] Legal review: running a custodial escrow may need licensing where you operate. Update Terms/Risk with your lawyer
- [ ] Paid mainnet RPC URL
- [ ] Set the Railway and Vercel variables above (switches the live site to mainnet)
- [ ] Put ~0.2 SOL operating balance in the company wallet
- [ ] Open `/admin` with the company wallet and confirm it loads the payouts panel
- [ ] **First real test with small amounts** (needs your explicit go-ahead): file a test listing with a 10-minute book, order 0.01 SOL from a second wallet, cancel one, let the bell ring, sign the payouts, check the pool and a small trade
- [ ] Hide the test listing in `/admin`
- [ ] Announce

## Rolling back
Set `PAYOUTS_PAUSED=1` on Railway (or press Emergency pause). Funds already deposited stay recorded in the state file and ledger; resume when fixed.
