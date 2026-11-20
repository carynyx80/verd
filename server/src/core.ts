// Pure IPO bookkeeping: no network calls, so every rule here is unit-tested (see test/core.test.ts).
import { BPS, NUM_TICKS, ONE_TOKEN, allocation, computeClearing, type Clearing } from "./auction.js";
import type { SendState } from "./solana.js";

export const MIN_ORDER_LAMPORTS = 10_000_000n; // 0.01 SOL
export const MAX_ORDER_LAMPORTS = BigInt(process.env.MAX_ORDER_LAMPORTS || 100_000_000_000); // 100 SOL

export type LaunchStatus = "pending" | "live" | "settling" | "trading" | "failed" | "expired";

export type LaunchRec = {
  id: string; // = mint address
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  saleSupply: string; // base units (bigint as string)
  creatorSupply: string;
  minPrice: string; // lamports per whole token
  maxPrice: string;
  lpBps: number;
  feeBps: number;
  swapFeeBps: number;
  roadshowSecs: number;
  orderSecs: number;
  lockSecs: number;
  status: LaunchStatus;
  preparedAt: number; // unix seconds
  createdAt: number;
  roadshowEnd: number;
  orderEnd: number;
  lockUntil: number;
  filingSig?: string;
  clearing?: { tick: number; price: string; eligibleBudget: string; soldValue: string; tokensSold: string };
  pool?: string;
};

export type OrderStatus = "active" | "cancelled" | "rejected" | "settled";
export type OrderRec = {
  sig: string;
  launch: string;
  buyer: string;
  lamports: string;
  maxTick: number;
  at: number; // block time
  status: OrderStatus;
  reason?: string;
};

export type PayoutKind = "refund" | "settle" | "fee" | "creator-sol" | "creator-tokens" | "lp-mint" | "pool" | "revoke" | "creator-release";
export type PayoutStatus = "queued" | "done" | "failed";
export type Payout = {
  id: string;
  launch: string;
  kind: PayoutKind;
  to: string;
  lamports: string; // SOL leaving the company wallet to `to`
  tokens: string; // tokens minted/transferred to `to`
  after: string[]; // payout ids that must be done first
  notBefore?: number; // unix seconds
  status: PayoutStatus;
  send: SendState;
  createdAt: number;
  doneAt?: number;
  orders?: string[]; // order signatures this payout settles
  secret?: number[]; // extra one-time signer (pool position NFT); never leaves the server
};

export type Unattributed = { sig: string; from: string; lamports: string; memo: string; at: number; note: string };

export type State = {
  launches: Record<string, LaunchRec>;
  orders: Record<string, OrderRec>;
  payouts: Record<string, Payout>;
  seen: Record<string, string>; // every company-wallet signature already processed -> outcome
  unattributed: Unattributed[];
  cursor?: string;
  paused: boolean;
  pauseNote?: string;
};

export const emptyState = (): State => ({ launches: {}, orders: {}, payouts: {}, seen: {}, unattributed: [], paused: false });

// ───── deposits ─────

/** What a parsed company-wallet transaction looks like to us. */
export type Deposit = { sig: string; from: string; lamports: bigint; memo: string; at: number; ok: boolean };

type ParsedIx = { program?: string; programId?: { toBase58(): string } | string; parsed?: unknown };

/**
 * Extracts an incoming SOL transfer to `company` from a jsonParsed transaction.
 * Returns null when nothing (or more than one sender) paid the company wallet.
 */
export function classifyDeposit(
  sig: string,
  tx: { meta: { err: unknown } | null; blockTime?: number | null; transaction: { message: { instructions: ParsedIx[] } } } | null,
  company: string,
): Deposit | null {
  if (!tx || !tx.meta) return null;
  let from = "", lamports = 0n, memo = "", senders = new Set<string>();
  for (const ix of tx.transaction.message.instructions) {
    const p = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } } | string | undefined;
    if (ix.program === "spl-memo" && typeof p === "string") memo = p;
    if (ix.program === "system" && p && typeof p === "object" && p.type === "transfer" && p.info?.destination === company && p.info.source) {
      senders.add(p.info.source);
      from = p.info.source;
      lamports += BigInt(p.info.lamports ?? 0);
    }
  }
  if (senders.size !== 1 || lamports <= 0n) return null;
  return { sig, from, lamports, memo: memo.trim(), at: tx.blockTime ?? 0, ok: tx.meta.err == null };
}

const ORDER_MEMO = /^stewra:order:([1-9A-HJ-NP-Za-km-z]{32,44}):(\d)$/;
const FILE_MEMO = /^stewra:file:([1-9A-HJ-NP-Za-km-z]{32,44})$/;

export const orderMemo = (launch: string, tick: number) => `stewra:order:${launch}:${tick}`;
export const fileMemo = (mint: string) => `stewra:file:${mint}`;

let seq = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function refund(state: State, launch: string, to: string, lamports: bigint, orders: string[], now: number): Payout {
  const p: Payout = { id: newId("rf"), launch, kind: "refund", to, lamports: lamports.toString(), tokens: "0", after: [], status: "queued", send: {}, createdAt: now, orders };
  state.payouts[p.id] = p;
  return p;
}

/**
 * Credits one finalized deposit exactly once. Valid orders are booked; anything that pays the
 * company wallet with an order memo but can't be accepted is refunded in full automatically.
 */
export function applyDeposit(state: State, d: Deposit, opts: { hidden: (launch: string) => boolean; now: number }): string {
  if (state.seen[d.sig]) return state.seen[d.sig];
  const mark = (outcome: string) => ((state.seen[d.sig] = outcome), outcome);
  if (!d.ok) return mark("failed-tx");

  if (FILE_MEMO.test(d.memo)) return mark("filing-fee");

  const m = d.memo.match(ORDER_MEMO);
  if (!m) {
    state.unattributed.push({ sig: d.sig, from: d.from, lamports: d.lamports.toString(), memo: d.memo.slice(0, 120), at: d.at, note: "no Stewra memo" });
    return mark("unattributed");
  }
  const [, launchId, tickStr] = m;
  const tick = Number(tickStr);
  const l = state.launches[launchId];
  let reason = "";
  if (!l || l.status === "pending" || l.status === "expired") reason = "unknown listing";
  else if (state.paused) reason = "Stewra was paused";
  else if (opts.hidden(launchId)) reason = "listing removed";
  else if (l.status !== "live") reason = "sale already closed";
  else if (d.at < l.roadshowEnd) reason = "order book not open yet";
  else if (d.at >= l.orderEnd) reason = "order book closed";
  else if (tick < 0 || tick >= NUM_TICKS) reason = "invalid price";
  else if (d.lamports < MIN_ORDER_LAMPORTS) reason = "below the 0.01 SOL minimum";
  else if (d.lamports > MAX_ORDER_LAMPORTS) reason = "above the per-order limit";

  const order: OrderRec = { sig: d.sig, launch: launchId, buyer: d.from, lamports: d.lamports.toString(), maxTick: tick, at: d.at, status: reason ? "rejected" : "active", reason: reason || undefined };
  state.orders[d.sig] = order;
  if (reason) {
    refund(state, launchId, d.from, d.lamports, [d.sig], opts.now);
    return mark(`rejected: ${reason}`);
  }
  return mark("order");
}

// ───── cancellations ─────

export const cancelMessage = (launch: string, ts: number) => `Stewra: cancel my orders\nlaunch: ${launch}\nts: ${ts}`;

/** Cancels all of a buyer's active orders in one listing and queues one refund. Caller verifies the signature. */
export function cancelOrders(state: State, launch: string, buyer: string, now: number): { refunded: bigint; error?: string } {
  const l = state.launches[launch];
  if (!l) return { refunded: 0n, error: "Listing not found" };
  if (l.status !== "live" || now >= l.orderEnd) return { refunded: 0n, error: "The order book is closed. Your refund comes automatically after the bell." };
  const mine = Object.values(state.orders).filter((o) => o.launch === launch && o.buyer === buyer && o.status === "active");
  if (!mine.length) return { refunded: 0n, error: "You have no open orders in this listing" };
  let total = 0n;
  for (const o of mine) { o.status = "cancelled"; total += BigInt(o.lamports); }
  refund(state, launch, buyer, total, mine.map((o) => o.sig), now);
  return { refunded: total };
}

// ───── the bell ─────

export function buckets(state: State, launch: string): bigint[] {
  const b = Array.from({ length: NUM_TICKS }, () => 0n);
  for (const o of Object.values(state.orders)) if (o.launch === launch && o.status === "active") b[o.maxTick] += BigInt(o.lamports);
  return b;
}

/**
 * Rings the bell: fixes the clearing price and queues every payment. Nothing is sent here.
 * Order of operations: buyers settled, fees and creator paid, tokens minted for the pool and the
 * creator's lockup, the pool created (liquidity locked), then the mint authority revoked so the
 * supply can never grow.
 */
export function ringBell(state: State, launchId: string, opts: { treasury: string; company: string; now: number }): Clearing {
  const l = state.launches[launchId];
  if (!l || l.status !== "live") throw new Error("Listing is not live");
  const sale = BigInt(l.saleSupply);
  const c = computeClearing(buckets(state, launchId), BigInt(l.minPrice), BigInt(l.maxPrice), sale);
  l.clearing = { tick: c.tick, price: c.price.toString(), eligibleBudget: c.eligibleBudget.toString(), soldValue: c.soldValue.toString(), tokensSold: c.tokensSold.toString() };
  l.lockUntil = opts.now + l.lockSecs;
  l.status = "settling";

  const add = (p: Omit<Payout, "id" | "launch" | "status" | "send" | "createdAt"> & { id?: string }) => {
    const full: Payout = { id: p.id ?? newId(p.kind), launch: launchId, status: "queued", send: {}, createdAt: opts.now, ...p };
    state.payouts[full.id] = full;
    return full.id;
  };

  // Per buyer: tokens + refund in one transfer.
  const byBuyer = new Map<string, { tokens: bigint; refund: bigint; orders: string[] }>();
  for (const o of Object.values(state.orders)) {
    if (o.launch !== launchId || o.status !== "active") continue;
    const a = allocation(BigInt(o.lamports), o.maxTick, c);
    const e = byBuyer.get(o.buyer) ?? { tokens: 0n, refund: 0n, orders: [] };
    e.tokens += a.tokens;
    e.refund += BigInt(o.lamports) - a.spent;
    e.orders.push(o.sig);
    byBuyer.set(o.buyer, e);
    o.status = "settled";
  }
  const mints: string[] = [];
  for (const [buyer, e] of byBuyer) {
    if (e.tokens === 0n && e.refund === 0n) continue;
    const id = add({ kind: "settle", to: buyer, lamports: e.refund.toString(), tokens: e.tokens.toString(), after: [], orders: e.orders });
    if (e.tokens > 0n) mints.push(id);
  }

  if (c.soldValue === 0n) {
    l.status = "settling"; // becomes "failed" once refunds land
    return c;
  }

  const fee = (c.soldValue * BigInt(l.feeBps)) / BPS;
  const lpSol = (c.soldValue * BigInt(l.lpBps)) / BPS;
  const toCreator = c.soldValue - fee - lpSol;
  const lpTokens = (lpSol * ONE_TOKEN) / c.price;
  const creatorTokens = (BigInt(l.creatorSupply) * c.tokensSold) / sale;

  if (opts.treasury !== opts.company && fee > 0n) add({ kind: "fee", to: opts.treasury, lamports: fee.toString(), tokens: "0", after: [] });
  if (toCreator > 0n) add({ kind: "creator-sol", to: l.creator, lamports: toCreator.toString(), tokens: "0", after: [] });
  let held = "";
  if (creatorTokens > 0n) {
    held = add({ kind: "creator-tokens", to: opts.company, lamports: "0", tokens: creatorTokens.toString(), after: [] });
    mints.push(held);
  }
  const lpMint = add({ kind: "lp-mint", to: opts.company, lamports: "0", tokens: lpTokens.toString(), after: [] });
  mints.push(lpMint);
  const pool = add({ kind: "pool", to: opts.company, lamports: lpSol.toString(), tokens: lpTokens.toString(), after: [lpMint] });
  add({ kind: "revoke", to: opts.company, lamports: "0", tokens: "0", after: [...mints, pool] });
  if (held) add({ kind: "creator-release", to: l.creator, lamports: "0", tokens: creatorTokens.toString(), after: [held], notBefore: l.lockUntil });
  return c;
}

/** A listing is finished settling when every payout except the far-future creator release is done. */
export function settleProgress(state: State, launchId: string) {
  const ps = Object.values(state.payouts).filter((p) => p.launch === launchId && p.kind !== "creator-release" && p.kind !== "refund");
  return { total: ps.length, done: ps.filter((p) => p.status === "done").length };
}

// ───── accounting ─────

/**
 * What the company wallet owes other people right now: SOL in open orders plus SOL in payouts not
 * yet sent. Platform fees are not liabilities. Compare against the wallet balance to see solvency.
 */
export function liabilities(state: State): { openOrders: bigint; pendingPayouts: bigint; total: bigint } {
  let openOrders = 0n, pendingPayouts = 0n;
  for (const o of Object.values(state.orders)) if (o.status === "active") openOrders += BigInt(o.lamports);
  for (const p of Object.values(state.payouts)) if (p.status !== "done" && p.kind !== "fee") pendingPayouts += BigInt(p.lamports);
  return { openOrders, pendingPayouts, total: openOrders + pendingPayouts };
}

/** Per-buyer view of their orders in one listing, with the expected result after the bell. */
export function buyerPosition(state: State, launchId: string, buyer: string) {
  const l = state.launches[launchId];
  const orders = Object.values(state.orders).filter((o) => o.launch === launchId && o.buyer === buyer).sort((a, b) => a.at - b.at);
  const payouts = Object.values(state.payouts).filter((p) => p.launch === launchId && p.to === buyer && (p.kind === "settle" || p.kind === "refund"));
  let tokens = 0n, refundDue = 0n;
  if (l?.clearing) {
    for (const p of payouts) if (p.kind === "settle") { tokens += BigInt(p.tokens); refundDue += BigInt(p.lamports); }
  }
  return {
    orders,
    tokens: tokens.toString(),
    refund: refundDue.toString(),
    payouts: payouts.map((p) => ({ id: p.id, kind: p.kind, lamports: p.lamports, tokens: p.tokens, status: p.status, sig: p.status === "done" ? p.send.sig : undefined })),
  };
}
