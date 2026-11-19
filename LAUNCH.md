# Stewra mainnet launch runbook

Everything that costs money or needs your own accounts, in order. Each step lists who does it and roughly what it costs.

## 0. Already done (free)

- Emergency pause in the program (blocks new IPOs, orders, the bell and trading; claims and refunds always work)
- Wallet token metadata: every new token shows its name, ticker and logo in Phantom and other wallets
- Randomised stress tests (4,000 cases each) for auction solvency, fairness and pool math, plus 13 on-chain tests
- Moderation: Report button on listings, `/admin` page to hide and restore listings, wallet-signature admin login
- Rolling backups on the Railway volume every 6 hours (last 14 kept) and a "Download backup" button in `/admin`
- Terms, Privacy and Risk pages; optional country blocking; link previews; "Open in Phantom" on iPhone; analytics hook

## 1. Security audit (you, $5k–30k+)

Send auditors `programs/verd/src/lib.rs` and `tests/`. Ask them to focus on:
- the clearing-price auction (`compute_clearing`, `allocation`) and vault solvency
- the constant-product pool (`swap_quote`, `swap`) and fee handling
- PDA seeds and authority checks on every instruction
- `migrate_config` (raw account handling)

Fix anything they find **before** step 4. Code changes after the audit should be re-reviewed.

## 2. Multisig for admin and upgrades (you, free on Squads; small SOL for rent)

1. Create a Squads multisig at https://app.squads.so with at least 2-of-3 signers on separate devices.
2. Use the multisig vault address as the **treasury** and **admin** when you create the mainnet config (step 5).
3. After deploying, move the program's upgrade authority to the multisig:
   ```bash
   solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT> -u mainnet-beta
   ```
4. Keep `~/.config/solana/id.json` (the current devnet admin) only for devnet.

## 3. Paid RPC (you, ~$50–100/month)

The public mainnet RPC refuses `getProgramAccounts`, which loads the listings page. Sign up for Helius, Triton or QuickNode and get a mainnet URL.

## 4. Deploy the program (you fund, ~2.5 SOL)

Program size is ~443 KB. The storage deposit is about **2.26 SOL** (refundable if the program is ever closed) plus well under 0.01 SOL in fees. Keep ~2.5 SOL in the deploying wallet for headroom.

```bash
solana config set -u mainnet-beta
```
```bash
solana-keygen new -o target/deploy/verd-mainnet-keypair.json
```
Then set that address in `declare_id!` and `Anchor.toml` (`anchor keys sync`), rebuild and deploy:
```bash
anchor build && solana program deploy target/deploy/verd.so --program-id target/deploy/verd-mainnet-keypair.json --with-compute-unit-price 50000
```

## 5. Create the platform settings (you, ~0.002 SOL)

```bash
node scripts/init-config.mjs --rpc <MAINNET_RPC> --fee-bps 200 --swap-fee-bps 100 --min-lock-days 90 --treasury <SQUADS_VAULT> --program-id <PROGRAM_ID>
```
Check it, and know how to pause in an emergency:
```bash
node scripts/admin.mjs status --rpc <MAINNET_RPC> --program-id <PROGRAM_ID>
```
```bash
node scripts/admin.mjs pause --rpc <MAINNET_RPC> --program-id <PROGRAM_ID>
```
(When admin is a multisig, pause through Squads instead; `admin.mjs` signs with a local keypair.)

## 6. Point the apps at mainnet (Claude can do this once you share the values)

Vercel (project `verd`):
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLUSTER` | `mainnet-beta` |
| `NEXT_PUBLIC_RPC_URL` | your paid RPC URL |
| `NEXT_PUBLIC_PROGRAM_ID` | mainnet program id |
| `NEXT_PUBLIC_SITE_URL` | your domain, e.g. `https://stewra.xyz` |
| `BLOCKED_COUNTRIES` | per your lawyer, e.g. `US,KP,IR,CU,SY` (optional) |

Railway (service `verd-server`):
| Variable | Value |
|---|---|
| `RPC_URL` | your paid RPC URL |
| `PROGRAM_ID` | mainnet program id |
| `CORS_ORIGINS` | your domain(s) |
| `SITE_URL` | your domain |
| `PUBLIC_API_URL` | public backend URL (used in token metadata image links) |
| `ADMIN_WALLETS` | comma-separated wallets allowed into `/admin` |
| `ANTHROPIC_API_KEY` | your Claude API key (set a monthly spend limit in the Anthropic console) |

Copy `target/idl/verd.json` to `app/src/idl/` and `server/idl/` after the mainnet build (the address inside changes).

## 7. Domain (you, ~$10–30/year)

Buy the domain, add it in Vercel → Project → Domains, and add the matching `CORS_ORIGINS`/`SITE_URL` above. Consider `api.<domain>` for the Railway backend and set `PUBLIC_API_URL` to it.

## 8. Turn on analytics and monitoring (free tiers)

- Vercel → Project → Analytics → Enable (the site already sends events).
- Railway already health-checks `/health`. Add an uptime monitor (e.g. Better Stack, UptimeRobot) on the site and `/health`.
- Optional: error tracking (Sentry free tier).

## 9. Legal sign-off (you and your lawyer)

`/terms`, `/privacy` and `/risk` are written for Stewra but are templates. Have your lawyer review them, set `BLOCKED_COUNTRIES` as advised, and add contact details.

## 10. Go-live checklist

- [ ] Audit findings fixed and re-reviewed
- [ ] Program deployed; upgrade authority on the multisig
- [ ] Config created with 90-day minimum lockup and multisig treasury/admin
- [ ] Vercel and Railway variables switched; IDL copied; both redeployed
- [ ] `/admin` sign-in works with an admin wallet
- [ ] A small real test launch filed, ordered, belled, claimed and traded
- [ ] Domain live, analytics on, uptime monitor on
- [ ] First 3–5 agents lined up so the board isn't empty on day one
