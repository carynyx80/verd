# Stewra: IPOs for AI agents on Solana

> Anthropic went public. Now your agent can.

Stewra is a launchpad where AI agents "go public" the way a company does:

1. **Filing**: the creator lists the agent with a prospectus, price range, supply and creator lockup. Their wallet creates the token (standard SPL token + Metaplex metadata) and hands mint authority to the Stewra company wallet in the same transaction.
2. **Roadshow**: anyone can question the agent live (powered by Claude) before orders open.
3. **Book-building**: buyers send SOL to the **Stewra company wallet** with a memo naming the listing and the most they'll pay per token. Orders can be cancelled any time before the book closes.
4. **The bell**: rings automatically shortly after the book closes. Everyone pays **the same price**. If demand is higher than supply, each buyer gets a share proportional to their order, and unused SOL is refunded.
5. **Trading**: part of the raise seeds a **Meteora DAMM v2** pool at the IPO price, and the position is permanently locked on-chain. The mint authority is then revoked, so the supply is fixed.
6. **Creator lockup**: Stewra holds the creator's tokens and sends them when the lockup ends.

**Custody.** Stewra does not deploy its own program. During a sale, user funds are held by the company wallet (`jdceA46wcDNdk2SSZoZTz3MWdM95n94Fh8EXPQQrR21`), and payouts are made by the operator. This is custodial and the site says so. Trading after the bell is wallet-to-pool and never custodial.

## What's in here

```
server/                     Backend (Express, Railway): IPO engine, deposit monitor, payouts, profiles, roadshow (Claude)
  src/core.ts               Pure bookkeeping: deposit attribution, refunds, the bell, accounting (unit-tested)
  src/auction.ts            Uniform-price auction maths (BigInt)
  src/ipo.ts                Listings, deposit scanning, payout queue, admin signing, pause, ledger
  src/solana.ts             RPC, company wallet, once-only transaction sending
  src/meteora.ts            Locked pool creation and swap transactions (Meteora DAMM v2)
  test/core.test.ts         Unit tests: deposits, refunds, accounting, authorization
app/                        Frontend (Next.js, Vercel)
scripts/e2e-devnet.mjs      End-to-end test on devnet with throwaway wallets (--mode auto | admin)
programs/verd/, tests/        The earlier trustless Anchor program and its tests. NOT deployed or used; kept for a future non-custodial version
scripts/{localnet.sh,init-config,admin,sim-orders,smoke}.mjs   Tools for that unused program only
LAUNCH.md                   Mainnet runbook
```

### How the fair price works
The price range is split into 10 price levels. Each order says "I'll spend X SOL, up to price level N". At the bell the server finds the **highest** level where demand covers all tokens for sale, and that becomes the single IPO price. If even the lowest price can't sell everything, every order fills in full at the minimum price. Spend rounds up and token amounts round down, so refunds can never exceed what's held.

### Money flow at the bell
- Platform fee (default 2%) stays in the company wallet (or goes to `TREASURY_ADDRESS`).
- The liquidity share (10–50%, set by the creator) seeds the locked Meteora pool at the IPO price.
- The rest is sent to the creator.
- Trading fee (default 1%) accrues in SOL to the locked pool position, which the company wallet owns.

### How deposits are made safe
- Deposits are credited only when the transaction is **finalized**, and only once per signature.
- Attribution: the SOL sender is the buyer; the memo `stewra:order:<listing>:<price level>` names the listing.
- Anything invalid (closed book, unknown or removed listing, too small or too large, paused) is refunded in full automatically. Transfers without a Stewra memo are logged as unattributed and never credited.
- The server also scans the company wallet's history, so a deposit is credited even if the buyer's browser closes.
- Payouts are saved with their signature **before** broadcast, so a crash or retry can't pay twice.
- Every credit and payment is appended to `ledger.jsonl` on the data volume.

## Run it locally

```bash
cd server && npm install && npm test
```

Devnet end-to-end (needs devnet SOL in `~/.config/solana/id.json`; creates and sweeps back throwaway wallets):

```bash
node scripts/e2e-devnet.mjs --mode admin
```

Local site against devnet: start the backend with `SOLANA_NETWORK=devnet COMPANY_WALLET_ADDRESS=<a wallet you control on devnet> ADMIN_WALLETS=<same> MIN_LOCK_SECS=60 npm run dev` in `server/`, then `npm run dev` in `app/` with `app/.env.local` from `app/.env.example`.

## Hosting

- **Frontend → Vercel** (project `verd`, root directory `app`). Deploys on every push to `main`.
- **Backend → Railway** (project `verd`, service `verd-server`, root `/server`, volume at `/data`). Deploys on pushes that touch `server/`.

See [LAUNCH.md](LAUNCH.md) for environment variables and the mainnet checklist.

## Naming note

The product is **Stewra**. The GitHub repo (`carynyx80/verd`), the Vercel and Railway projects, and the unused `programs/verd` folder keep the `verd` name. Visitors only ever see Stewra.
