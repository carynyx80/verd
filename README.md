# Stewra: IPOs for AI agents on Solana

> Anthropic went public. Now your agent can.

Stewra is a launchpad where AI agents "go public" the way a company does:

1. **Filing**: the creator lists the agent with a prospectus, price range, supply and creator lockup.
2. **Roadshow**: anyone can question the agent live (powered by Claude) before orders open.
3. **Book-building**: buyers deposit SOL with the most they'll pay per token. Orders can be cancelled any time before the book closes.
4. **The bell**: anyone can ring it once the book closes. Everyone pays **the same price**. If demand is higher than supply, each buyer gets a share proportional to their order, and unused SOL is refunded.
5. **Trading**: part of the money raised seeds a trading pool at exactly the IPO price. That liquidity can **never** be withdrawn.
6. **Creator lockup**: creator tokens can't be claimed until the lockup ends.

All of the sale rules are enforced by the on-chain program, not by the website.

## What's in here

```
programs/verd/src/lib.rs   On-chain program (Anchor): auction, escrow, bell, claims, pool, lockups
tests/verd.ts              Full-lifecycle tests on a local validator (11 tests)
scripts/localnet.sh        Starts a local validator with Stewra loaded and sets up the platform
scripts/init-config.mjs    One-time platform setup on any network (fees, treasury, minimum lockup)
scripts/sim-orders.mjs     Dev helper: places orders from test wallets
app/                       Frontend (Next.js, deployed on Vercel): listings, filing, roadshow, order book, bell, trading
server/                    Backend (Express, deployed on Railway): agent profiles, roadshow Q&A via Claude, prospectus drafts
```

### How the fair price works
The price range is split into 10 price levels. Each order says "I'll spend X SOL, up to price level N".
At the bell the program finds the **highest** level where demand covers all tokens for sale, and that
becomes the single IPO price. If even the lowest price can't sell everything, every order fills in full
at the minimum price. The calculation runs in constant time on-chain, so it works with any number of orders.

### Money flow at the bell
- Platform fee (default 2%) goes to the treasury.
- The liquidity share (10–50%, set by the creator) seeds the locked pool at the IPO price.
- The rest goes to the creator.
- Trading fee (default 1%) on every swap goes to the treasury.

## Run it locally

Requirements: Node 22, Rust, Solana CLI (Agave), Anchor 0.32.

```bash
anchor build
```

```bash
anchor test
```

Start a local chain with Stewra deployed (keep this running):

```bash
./scripts/localnet.sh
```

In a second terminal, start the backend (put `ANTHROPIC_API_KEY=...` in `server/.env` first):

```bash
cd server && npm install && npm run dev
```

In a third terminal, start the website:

```bash
cd app && cp .env.example .env.local && npm install && npm run dev
```

Open http://localhost:3000, click **Select Wallet → Burner Wallet** (a throwaway test wallet that only exists on localnet), then **Get test SOL**.
On localnet the create form defaults to minutes-long phases, so you can run a whole IPO in about 5 minutes.

Add your Claude API key to `server/.env` (`ANTHROPIC_API_KEY=...`) so the roadshow agents can answer questions and "Draft with AI" can write prospectuses. Without it, both show a clear "not configured" message and everything else works.

To simulate other buyers during the order window:

```bash
node scripts/sim-orders.mjs <LAUNCH_ADDRESS> "6@9" "2@3"
```

## Deploy to devnet

```bash
solana config set -u devnet
```

```bash
solana airdrop 2
```

(Deploying needs about 3 SOL on devnet. Repeat the airdrop, or use https://faucet.solana.com.)

```bash
anchor deploy --provider.cluster devnet
```

```bash
node scripts/init-config.mjs --rpc https://api.devnet.solana.com --fee-bps 200 --swap-fee-bps 100 --min-lock-days 0
```

Then set `NEXT_PUBLIC_CLUSTER=devnet` and `NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com` in `app/.env.local`.

## Before mainnet (do not skip)

- **Security audit** of `programs/verd`. It holds user funds.
- Set a real minimum creator lockup: `--min-lock-days 90`.
- Use a dedicated treasury wallet (ideally a multisig), and consider transferring the program upgrade authority to a multisig.
- Replace the JSON file store in `server/src/store.ts` (agent profiles and roadshow transcripts) with a real database before running more than one server.
- Use a paid RPC provider (Helius, Triton, etc.) instead of the public endpoint.
- Legal: you've done your legal review. Keep geoblocking and terms in line with it.
- Token metadata (name and logo inside wallets) isn't set yet. Add Metaplex metadata in `create_launch` if you want tokens to display nicely in Phantom.

## Hosting

- **Frontend → Vercel** (project `verd`, root directory `app`). Deploys automatically on every push to `main`.
- **Backend → Railway** (project `verd`, service `verd-server`, root directory `/server`, volume mounted at `/data`). Deploys automatically on pushes that touch `server/`.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `NEXT_PUBLIC_CLUSTER` | Vercel | `localnet`, `devnet` or `mainnet-beta` |
| `NEXT_PUBLIC_RPC_URL` | Vercel | Solana RPC endpoint |
| `NEXT_PUBLIC_PROGRAM_ID` | Vercel | Deployed Stewra program id |
| `NEXT_PUBLIC_API_URL` | Vercel | Backend URL (the Railway domain) |
| `ANTHROPIC_API_KEY` | Railway | Claude API key for roadshow Q&A and prospectus drafts |
| `RPC_URL` | Railway | Solana RPC endpoint the backend reads launches from |
| `PROGRAM_ID` | Railway | Deployed Stewra program id |
| `CORS_ORIGINS` | Railway | Comma-separated frontend URLs allowed to call the API |
| `DATA_DIR` | Railway | Where profiles and transcripts are stored (`/data` volume) |

Program id (local and default): `3ty1t4idNWNRgVFzwoTqYKZBz2SLTaLtYv6WbGEe3nzN`. For your own deployment, generate a new keypair with `solana-keygen new -o target/deploy/verd-keypair.json`, then run `anchor keys sync` and `anchor build`.

## Naming note

The product is **Stewra**. The on-chain program keeps its original internal name `verd` (folder `programs/verd`, files `target/deploy/verd.so` and `verd-keypair.json`, IDL `verd.json`) so it stays at the same address without redeploying. Users never see this name. The GitHub repo (`carynyx80/verd`) and the Vercel and Railway projects also keep the `verd` name; everything visitors see says Stewra.
