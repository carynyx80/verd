// End-to-end test of the company-wallet flow on DEVNET with throwaway wallets.
//   node scripts/e2e-devnet.mjs [--mode auto|admin]
// Funds the test wallets from ~/.config/solana/id.json (devnet SOL), starts the server, files a listing,
// places orders (one refused, one cancelled), lets the bell ring, settles payouts (automatically or by
// "admin" signing like the browser would), checks the Meteora pool, trades, waits for the creator release,
// checks solvency, and sweeps leftover devnet SOL back.
import { createRequire } from "module";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "server/package.json"));
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const bs58 = require("bs58").default;
const { ed25519 } = require("@noble/curves/ed25519");
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = web3;

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "auto";
const RPC = "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const PORT = 4100 + (mode === "admin" ? 1 : 0);
const API = `http://127.0.0.1:${PORT}`;
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));

const company = Keypair.generate(), creator = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate(), carol = Keypair.generate();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
let failures = 0;
const check = (ok, what) => { console.log(ok ? "  ✓" : "  ✗", what); if (!ok) failures++; };
const j = async (p, body) => {
  const r = await fetch(API + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const memoIx = (t) => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(t) });
const pay = (from, to, lamports, memo) => {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }));
  if (memo) tx.add(memoIx(memo));
  return sendAndConfirmTransaction(conn, tx, [from], { commitment: "confirmed" });
};
const adminMsg = (action, launch, ts) => `Sipt admin\naction: ${action}\nlaunch: ${launch}\nts: ${ts}`;
const ledger0 = (v) => v.recent.some((p) => p.kind === "refund" && p.lamports === String(0.02 * LAMPORTS_PER_SOL));
const adminAuth = (action) => { const ts = Date.now(); return { wallet: company.publicKey.toBase58(), ts, action, launch: "", signature: bs58.encode(ed25519.sign(new TextEncoder().encode(adminMsg(action, "", ts)), company.secretKey.slice(0, 32))) }; };

// ── 1. fund test wallets
log(`mode=${mode}; funding test wallets from ${funder.publicKey.toBase58()}`);
const fundTx = new Transaction();
for (const [kp, sol] of [[company, 0.25], [creator, 0.15], [alice, 0.9], [bob, 0.4], [carol, 0.25]]) fundTx.add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: kp.publicKey, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
await sendAndConfirmTransaction(conn, fundTx, [funder], { commitment: "confirmed" });

// ── 2. server
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stewra-e2e-"));
const env = {
  ...process.env, PORT: String(PORT), SOLANA_NETWORK: "devnet", RPC_URL: RPC, DATA_DIR: dataDir,
  COMPANY_WALLET_ADDRESS: company.publicKey.toBase58(), ADMIN_WALLETS: company.publicKey.toBase58(),
  MIN_LOCK_SECS: "60", LISTING_FEE_LAMPORTS: "50000000", CORS_ORIGINS: "http://localhost:3000", ANTHROPIC_API_KEY: "",
  ...(mode === "auto" ? { COMPANY_WALLET_SECRET: bs58.encode(company.secretKey) } : { COMPANY_WALLET_SECRET: "" }),
};
const server = spawn("npx", ["tsx", "src/index.ts"], { cwd: path.join(root, "server"), env, stdio: ["ignore", "pipe", "pipe"] });
const serverLog = [];
server.stdout.on("data", (d) => serverLog.push(String(d)));
server.stderr.on("data", (d) => serverLog.push(String(d)));
const cleanup = () => { try { server.kill(); } catch {} };
process.on("exit", cleanup);
for (let i = 0; i < 180; i++) { try { if ((await j("/health")).status === 200) break; } catch {} await sleep(1000); }
const health = (await j("/health")).body;
check(health.network === "devnet" && health.company === company.publicKey.toBase58(), `server up on ${health.network}, company ${health.company?.slice(0, 6)}…`);

try {
  // ── 3. file a listing (creator signs; server partially signed with the mint key)
  log("filing");
  const prep = await j("/api/launches/prepare", {
    creator: creator.publicKey.toBase58(), name: "E2E Agent", symbol: "E2E", saleSupply: String(1000 * 1e6), creatorSupply: String(100 * 1e6),
    minPrice: String(0.0002 * LAMPORTS_PER_SOL), maxPrice: String(0.002 * LAMPORTS_PER_SOL), lpBps: 3000, roadshowSecs: 0, orderSecs: 75, lockSecs: 60,
  });
  check(prep.status === 200, `prepare filing (${prep.body.error ?? "ok"})`);
  const launch = prep.body.launch;
  const ftx = Transaction.from(Buffer.from(prep.body.tx, "base64"));
  ftx.partialSign(creator);
  const fsig = await conn.sendRawTransaction(ftx.serialize());
  await conn.confirmTransaction(fsig, "confirmed");
  let st = "";
  for (let i = 0; i < 40 && st !== "live"; i++) { st = (await j(`/api/launches/${launch}/confirm`, {})).body.status; if (st !== "live") await sleep(2000); }
  check(st === "live", "listing activated after finality");
  const mintInfo = await spl.getMint(conn, new PublicKey(launch));
  check(mintInfo.mintAuthority?.equals(company.publicKey) && mintInfo.supply === 0n && !mintInfo.freezeAuthority, "mint authority = company wallet, supply 0, no freeze authority");

  // ── 4. orders
  log("orders");
  const order = async (kp, sol, tick, target = launch) => {
    const sig = await pay(kp, company.publicKey, Math.round(sol * LAMPORTS_PER_SOL), `stewra:order:${target}:${tick}`);
    for (let i = 0; i < 40; i++) { const r = await j("/api/orders", { signature: sig }); if (r.status === 200) return r.body.status; await sleep(2000); }
    return "timeout";
  };
  check((await order(alice, 0.6, 9)) === "order", "alice 0.6 SOL @ top price credited after finality");
  check((await order(bob, 0.3, 0)) === "order", "bob 0.3 SOL @ min price credited");
  check((await order(carol, 0.1, 5)) === "order", "carol 0.1 SOL credited");
  const dupe = await j("/api/orders", { signature: (await j(`/api/launches/${launch}/position?buyer=${alice.publicKey.toBase58()}`)).body.orders[0].sig });
  check(dupe.body.status === "order" && (await j(`/api/launches/${launch}/position?buyer=${alice.publicKey.toBase58()}`)).body.orders.length === 1, "re-reporting a deposit doesn't double-credit");
  check(String(await order(carol, 0.02, 3, Keypair.generate().publicKey.toBase58())).startsWith("rejected"), "order for unknown listing refused (auto-refund queued)");
  const ts = Date.now();
  const cx = await j(`/api/launches/${launch}/cancel`, { buyer: carol.publicKey.toBase58(), ts, signature: bs58.encode(ed25519.sign(new TextEncoder().encode(`Sipt: cancel my orders\nlaunch: ${launch}\nts: ${ts}`), carol.secretKey.slice(0, 32))) });
  check(cx.status === 200 && cx.body.refunded === String(0.1 * LAMPORTS_PER_SOL), "carol cancels with a wallet signature");
  const forged = await j(`/api/launches/${launch}/cancel`, { buyer: alice.publicKey.toBase58(), ts, signature: bs58.encode(ed25519.sign(new TextEncoder().encode(`Sipt: cancel my orders\nlaunch: ${launch}\nts: ${ts}`), carol.secretKey.slice(0, 32))) });
  check(forged.status === 400, "cannot cancel someone else's order");

  // ── 5. settle (bell rings ~45s after the book closes)
  const settleRound = async () => {
    if (mode !== "admin") return;
    const built = await j("/api/admin/payouts/build", adminAuth("sign-payouts"));
    const items = built.body.items ?? [];
    if (!items.length) return;
    const signed = items.map((i) => { const t = Transaction.from(Buffer.from(i.tx, "base64")); t.partialSign(company); return { id: i.id, tx: t.serialize().toString("base64") }; });
    const sub = await j("/api/admin/payouts/submit", { items: signed });
    log(`admin signed ${items.length}: ${items.map((i) => i.kind).join(", ")}; ok=${sub.body.results.filter((r) => r.ok).length}`);
  };
  if (mode === "admin") {
    const bad = await j("/api/admin/payouts/build", { ...adminAuth("sign-payouts"), wallet: alice.publicKey.toBase58() });
    check(bad.status === 401, "non-admin can't request payout transactions");
  }
  log("waiting for the book to close and the bell");
  let L;
  for (let i = 0; i < 120; i++) {
    L = (await j(`/api/launches/${launch}`)).body;
    if (L.status === "trading" || L.status === "failed") break;
    await settleRound();
    await sleep(4000);
  }
  check(L.status === "trading", `listing trading (status ${L.status}, settled ${L.settle?.done}/${L.settle?.total})`);
  check(L.clearingPrice === 0.0006 * LAMPORTS_PER_SOL, `clearing price ${L.clearingPrice / 1e9} SOL (expected 0.0006)`);

  const bal = async (owner) => { try { return Number((await conn.getTokenAccountBalance(spl.getAssociatedTokenAddressSync(new PublicKey(launch), owner.publicKey))).value.amount); } catch { return 0; } };
  check((await bal(alice)) === 1000 * 1e6, `alice received ${(await bal(alice)) / 1e6} tokens`);
  check((await bal(bob)) === 0, "bob (below clearing price) got no tokens");
  const posBob = (await j(`/api/launches/${launch}/position?buyer=${bob.publicKey.toBase58()}`)).body;
  check(posBob.payouts.some((p) => p.kind === "settle" && p.lamports === String(0.3 * LAMPORTS_PER_SOL) && p.status === "done"), "bob refunded 0.3 SOL in full");
  const posCarol = (await j(`/api/launches/${launch}/position?buyer=${carol.publicKey.toBase58()}`)).body;
  check(posCarol.payouts.some((p) => p.kind === "refund" && p.lamports === String(0.1 * LAMPORTS_PER_SOL) && p.status === "done"), "carol's cancellation refunded");
  const mintAfter = await spl.getMint(conn, new PublicKey(launch));
  check(mintAfter.mintAuthority === null, `mint authority revoked; supply fixed at ${Number(mintAfter.supply) / 1e6}`);
  check(Boolean(L.pool) && L.poolSol > 0 && L.poolTokens > 0, `Meteora pool ${L.pool?.slice(0, 6)}… holds ${L.poolSol / 1e9} SOL / ${L.poolTokens / 1e6} tokens`);

  // ── 6. trade against the locked pool (trader signs their own tx)
  log("trading");
  const swap = async (kp, buy, amountIn) => {
    const q = await j("/api/swap", { mint: launch, trader: kp.publicKey.toBase58(), buy, amountIn: String(amountIn), slippageBps: 300 });
    if (q.status !== 200) throw new Error(q.body.error);
    const t = Transaction.from(Buffer.from(q.body.tx, "base64"));
    t.partialSign(kp);
    const sig = await conn.sendRawTransaction(t.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    return q.body;
  };
  const before = await bal(bob);
  await swap(bob, true, 0.02 * LAMPORTS_PER_SOL);
  check((await bal(bob)) > before, `bob bought ${((await bal(bob)) - before) / 1e6} tokens from the pool`);
  const aliceBefore = await conn.getBalance(alice.publicKey);
  await swap(alice, false, 100 * 1e6);
  check((await bal(alice)) === 900 * 1e6 && (await conn.getBalance(alice.publicKey)) > aliceBefore, "alice sold 100 tokens for SOL");

  // ── 7. creator release after the lockup
  log("waiting for creator lockup");
  for (let i = 0; i < 40; i++) {
    const c = await bal(creator);
    if (c > 0) break;
    await settleRound();
    await sleep(4000);
  }
  check((await bal(creator)) === 100 * 1e6, `creator received ${(await bal(creator)) / 1e6} locked tokens after the lockup`);

  // ── 8. accounting
  let adminView;
  for (let i = 0; i < 10; i++) { adminView = (await j("/api/admin/payouts", adminAuth("payouts"))).body; if (!adminView.pending.length) break; await sleep(4000); }
  check(adminView.pending.length === 0, `no payouts outstanding (${JSON.stringify(adminView.pending.map((p) => [p.kind, p.error]))})`);
  check(ledger0(adminView), "refused order refunded");
  check(BigInt(adminView.solvency.surplus) >= 0n && adminView.solvency.owed === "0", `solvent: balance ${Number(adminView.solvency.balance) / 1e9} SOL, owed ${adminView.solvency.owed}`);
  const ledger = (await j("/api/admin/ledger", adminAuth("ledger"))).body.ledger;
  const types = ledger.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  check(types.deposit === 3 && types["deposit-rejected"] === 1 && types.bell === 1 && types["payout:settle"] === 2 && types["payout:refund"] === 2, `ledger: ${JSON.stringify(types)}`);
} catch (e) {
  failures++;
  console.error("ERROR", e);
  console.error(serverLog.slice(-30).join(""));
} finally {
  cleanup();
  // sweep devnet SOL back to the funder
  for (const kp of [company, creator, alice, bob, carol]) {
    const b = await conn.getBalance(kp.publicKey).catch(() => 0);
    if (b > 10_000) await pay(kp, funder.publicKey, b - 5000).catch(() => {});
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}
