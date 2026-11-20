// Run: npm test (node --test with tsx). No network access needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

const company = Keypair.generate();
const admin = Keypair.generate();
process.env.COMPANY_WALLET_ADDRESS = company.publicKey.toBase58();
process.env.ADMIN_WALLETS = admin.publicKey.toBase58();
process.env.RPC_URL = "http://127.0.0.1:1"; // nothing in these tests may touch the network

const core = await import("../src/core.js");
const { allocation, computeClearing, ONE_TOKEN } = await import("../src/auction.js");
const { verifyAdmin, adminMessage } = await import("../src/admin.js");
const { broadcast } = await import("../src/solana.js");

const C = company.publicKey.toBase58();
const LAUNCH = Keypair.generate().publicKey.toBase58();
const SOL = 1_000_000_000n;
const wallet = () => Keypair.generate().publicKey.toBase58();

function freshState() {
  const s = core.emptyState();
  s.launches[LAUNCH] = {
    id: LAUNCH, mint: LAUNCH, creator: wallet(), name: "Test", symbol: "TST",
    saleSupply: (1_000_000n * ONE_TOKEN).toString(), creatorSupply: (100_000n * ONE_TOKEN).toString(),
    minPrice: "1000", maxPrice: "10000", lpBps: 3000, feeBps: 200, swapFeeBps: 100,
    roadshowSecs: 0, orderSecs: 100, lockSecs: 1000, status: "live", preparedAt: 0, createdAt: 1000, roadshowEnd: 1000, orderEnd: 1100, lockUntil: 0,
  };
  return s;
}
const opts = { hidden: () => false, now: 1050 };
let n = 0;
const dep = (from: string, lamports: bigint, memo: string, at = 1050, ok = true) => ({ sig: `sig${n++}${"1".repeat(70)}`.slice(0, 80), from, lamports, memo, at, ok });

// ───── deposits ─────

test("classifyDeposit attributes a transfer to the company wallet to its sender", () => {
  const buyer = wallet();
  const tx = {
    meta: { err: null }, blockTime: 1234,
    transaction: { message: { instructions: [
      { program: "system", parsed: { type: "transfer", info: { source: buyer, destination: C, lamports: 5e8 } } },
      { program: "system", parsed: { type: "transfer", info: { source: buyer, destination: wallet(), lamports: 1e9 } } },
      { program: "spl-memo", parsed: core.orderMemo(LAUNCH, 3) },
    ] } },
  };
  const d = core.classifyDeposit("s", tx, C)!;
  assert.equal(d.from, buyer);
  assert.equal(d.lamports, 500_000_000n); // the transfer elsewhere is ignored
  assert.equal(d.memo, `stewra:order:${LAUNCH}:3`);
  assert.equal(d.at, 1234);
});

test("classifyDeposit refuses ambiguous deposits from two senders, and non-deposits", () => {
  const ix = (src: string) => ({ program: "system", parsed: { type: "transfer", info: { source: src, destination: C, lamports: 1e8 } } });
  assert.equal(core.classifyDeposit("s", { meta: { err: null }, transaction: { message: { instructions: [ix(wallet()), ix(wallet())] } } }, C), null);
  assert.equal(core.classifyDeposit("s", { meta: { err: null }, transaction: { message: { instructions: [] } } }, C), null);
  assert.equal(core.classifyDeposit("s", null, C), null);
});

test("a valid order is credited exactly once", () => {
  const s = freshState();
  const d = dep(wallet(), SOL, core.orderMemo(LAUNCH, 9));
  assert.equal(core.applyDeposit(s, d, opts), "order");
  assert.equal(core.applyDeposit(s, d, opts), "order"); // replay
  assert.equal(Object.keys(s.orders).length, 1);
  assert.equal(core.liabilities(s).openOrders, SOL);
  assert.equal(Object.keys(s.payouts).length, 0);
});

test("failed transactions are never credited", () => {
  const s = freshState();
  assert.equal(core.applyDeposit(s, dep(wallet(), SOL, core.orderMemo(LAUNCH, 1), 1050, false), opts), "failed-tx");
  assert.equal(core.liabilities(s).total, 0n);
});

test("orders that can't be accepted are refunded in full", () => {
  const cases: [string, ReturnType<typeof dep>, Partial<typeof opts>, ((s: ReturnType<typeof freshState>) => void)?][] = [
    ["closed", dep(wallet(), SOL, core.orderMemo(LAUNCH, 1), 1100), {}],
    ["too small", dep(wallet(), 1_000_000n, core.orderMemo(LAUNCH, 1)), {}],
    ["unknown listing", dep(wallet(), SOL, core.orderMemo(wallet(), 1)), {}],
    ["hidden", dep(wallet(), SOL, core.orderMemo(LAUNCH, 1)), { hidden: () => true }],
    ["paused", dep(wallet(), SOL, core.orderMemo(LAUNCH, 1)), {}, (s) => { s.paused = true; }],
  ];
  for (const [name, d, o, setup] of cases) {
    const s = freshState();
    setup?.(s);
    const outcome = core.applyDeposit(s, d, { ...opts, ...o });
    assert.match(outcome, /^rejected/, name);
    const refunds = Object.values(s.payouts);
    assert.equal(refunds.length, 1, name);
    assert.equal(refunds[0].kind, "refund");
    assert.equal(refunds[0].to, d.from);
    assert.equal(refunds[0].lamports, d.lamports.toString(), name);
    assert.equal(core.liabilities(s).openOrders, 0n, name);
  }
});

test("deposits without a Stewra memo are logged, not credited", () => {
  const s = freshState();
  assert.equal(core.applyDeposit(s, dep(wallet(), SOL, "hello"), opts), "unattributed");
  assert.equal(s.unattributed.length, 1);
  assert.equal(core.liabilities(s).total, 0n);
});

// ───── cancellations ─────

test("cancel refunds only the caller's open orders, once", () => {
  const s = freshState();
  const a = wallet(), b = wallet();
  core.applyDeposit(s, dep(a, SOL, core.orderMemo(LAUNCH, 9)), opts);
  core.applyDeposit(s, dep(a, 2n * SOL, core.orderMemo(LAUNCH, 5)), opts);
  core.applyDeposit(s, dep(b, SOL, core.orderMemo(LAUNCH, 9)), opts);
  const r = core.cancelOrders(s, LAUNCH, a, 1060);
  assert.equal(r.refunded, 3n * SOL);
  assert.ok(core.cancelOrders(s, LAUNCH, a, 1061).error); // nothing left
  assert.equal(core.liabilities(s).openOrders, SOL); // b untouched
  assert.equal(core.liabilities(s).pendingPayouts, 3n * SOL);
  assert.ok(core.cancelOrders(s, LAUNCH, b, 1100).error); // book closed
});

// ───── the bell ─────

function bookAndRing(orders: [bigint, number][]) {
  const s = freshState();
  const buyers = orders.map(([lamports, tick]) => {
    const w = wallet();
    core.applyDeposit(s, dep(w, lamports, core.orderMemo(LAUNCH, tick)), opts);
    return w;
  });
  const deposits = orders.reduce((x, [l]) => x + l, 0n);
  const c = core.ringBell(s, LAUNCH, { treasury: C, company: C, now: 1200 });
  return { s, c, buyers, deposits };
}

test("oversubscribed: everyone pays one price, nothing is lost or created", () => {
  const { s, c, deposits } = bookAndRing([[10n * SOL, 9], [5n * SOL, 6], [3n * SOL, 2], [1n * SOL, 0]]);
  assert.equal(c.tokensSold, 1_000_000n * ONE_TOKEN);
  const payouts = Object.values(s.payouts);
  const settles = payouts.filter((p) => p.kind === "settle");
  const tokensToBuyers = settles.reduce((x, p) => x + BigInt(p.tokens), 0n);
  assert.ok(tokensToBuyers <= c.tokensSold && tokensToBuyers > c.tokensSold - 1000n * ONE_TOKEN / 1000n);
  const refunds = settles.reduce((x, p) => x + BigInt(p.lamports), 0n);
  const creator = payouts.filter((p) => p.kind === "creator-sol").reduce((x, p) => x + BigInt(p.lamports), 0n);
  const pool = payouts.filter((p) => p.kind === "pool").reduce((x, p) => x + BigInt(p.lamports), 0n);
  const fee = (c.soldValue * 200n) / 10_000n;
  // every lamport deposited is either refunded, paid to the creator, put in the pool, or the fee
  assert.ok(deposits - (refunds + creator + pool + fee) >= 0n);
  assert.ok(deposits - (refunds + creator + pool + fee) < 10n);
  assert.equal(core.liabilities(s).total, refunds + creator + pool);
  // revoke waits for every mint and the pool; creator release waits for its lockup
  const revoke = payouts.find((p) => p.kind === "revoke")!;
  for (const p of payouts.filter((p) => ["settle", "lp-mint", "creator-tokens", "pool"].includes(p.kind) && BigInt(p.tokens) > 0n)) assert.ok(revoke.after.includes(p.id), p.kind);
  assert.equal(payouts.find((p) => p.kind === "creator-release")!.notBefore, 1200 + 1000);
});

test("orders below the clearing price get a full refund and no tokens", () => {
  const { s, c, buyers } = bookAndRing([[20n * SOL, 9], [1n * SOL, 0]]);
  assert.ok(c.tick > 0);
  const low = Object.values(s.payouts).find((p) => p.kind === "settle" && p.to === buyers[1])!;
  assert.equal(low.tokens, "0");
  assert.equal(low.lamports, SOL.toString());
});

test("undersubscribed: everyone fills at the minimum price", () => {
  const { s, c, deposits } = bookAndRing([[SOL * 3n / 10n, 9], [SOL / 5n, 3]]) // 0.5 SOL total; selling everything at the minimum needs 1 SOL;
  assert.equal(c.price, 1000n);
  assert.equal(c.soldValue, deposits);
  for (const p of Object.values(s.payouts).filter((p) => p.kind === "settle")) assert.equal(p.lamports, "0");
});

test("no demand: nothing to settle, no pool, no fees", () => {
  const s = freshState();
  const c = core.ringBell(s, LAUNCH, { treasury: C, company: C, now: 1200 });
  assert.equal(c.soldValue, 0n);
  assert.equal(Object.keys(s.payouts).length, 0);
  assert.throws(() => core.ringBell(s, LAUNCH, { treasury: C, company: C, now: 1201 })); // can't ring twice
});

test("allocation never spends more than the order", () => {
  const c = computeClearing([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 7n * SOL], 1000n, 10000n, 1000n * ONE_TOKEN);
  for (const b of [10_000_000n, 333_333_333n, 7n * SOL]) {
    const a = allocation(b, 9, c);
    assert.ok(a.spent <= b);
  }
});

// ───── authorization ─────

test("admin actions need a fresh signature from an admin wallet", () => {
  const ts = Date.now();
  const sign = (kp: Keypair, action: string, t: number) => bs58.encode(ed25519.sign(new TextEncoder().encode(adminMessage(action, "", t)), kp.secretKey.slice(0, 32)));
  const good = { wallet: admin.publicKey.toBase58(), signature: sign(admin, "pause", ts), ts, action: "pause" };
  assert.equal(verifyAdmin(good), null);
  assert.match(verifyAdmin(good)!, /already used/); // replay
  const outsider = Keypair.generate();
  assert.match(verifyAdmin({ wallet: outsider.publicKey.toBase58(), signature: sign(outsider, "pause", ts), ts, action: "pause" })!, /isn't an admin/);
  assert.match(verifyAdmin({ ...good, signature: sign(admin, "pause", ts - 10 * 60_000), ts: ts - 10 * 60_000 })!, /expired/);
  assert.match(verifyAdmin({ ...good, signature: sign(admin, "unpause", ts + 1), ts: ts + 1 })!, /Invalid/); // signed a different action
});

test("payouts are only broadcast with a valid company-wallet signature", async () => {
  const tx = new Transaction({ feePayer: company.publicKey, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 });
  tx.add(SystemProgram.transfer({ fromPubkey: company.publicKey, toPubkey: new PublicKey(wallet()), lamports: 1 }));
  const state = {};
  await assert.rejects(broadcast(state, tx, 1, async () => {}), /not fully signed/);
  const forged = Keypair.generate();
  const tx2 = new Transaction({ feePayer: forged.publicKey, blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 });
  tx2.add(SystemProgram.transfer({ fromPubkey: company.publicKey, toPubkey: forged.publicKey, lamports: 1 }));
  tx2.partialSign(forged);
  await assert.rejects(broadcast(state, tx2, 1, async () => {}), /not fully signed/);
  assert.equal((state as { sig?: string }).sig, undefined); // nothing recorded, nothing sent
});
