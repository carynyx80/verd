// The IPO engine: listings, deposit monitoring, the bell, and payouts from the company wallet.
import { promises as fs } from "fs";
import path from "path";
import {
  AuthorityType, MINT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction,
  createMintToInstruction, createSetAuthorityInstruction, createTransferInstruction, getAssociatedTokenAddressSync, unpackMint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { BPS, NUM_TICKS, ONE_TOKEN, tickPrice } from "./auction.js";
import {
  applyDeposit, buckets, buyerPosition, cancelMessage, cancelOrders, classifyDeposit, emptyState, fileMemo, liabilities, newId,
  ringBell, settleProgress, type LaunchRec, type Payout, type State,
} from "./core.js";
import {
  COMPANY, NETWORK, TREASURY, broadcast, buildTx, checkSent, connection, createMetadataIx, memoIx, metadataPda, requireCompany,
  serverSigner, type Built,
} from "./solana.js";
import { SWAP_FEE_BPS, buildCreatePool, getPool } from "./meteora.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "ipo.json");
const LEDGER_FILE = path.join(DATA_DIR, "ledger.jsonl");

export const FEE_BPS = Number(process.env.FEE_BPS || 200);
export const MIN_LOCK_SECS = Number(process.env.MIN_LOCK_SECS ?? 90 * 86400);
export const LISTING_FEE_LAMPORTS = BigInt(process.env.LISTING_FEE_LAMPORTS || 50_000_000); // 0.05 SOL covers pool rent and payout fees
const BELL_GRACE_SECS = 45; // let deposits sent just before the close finalize
/** Payouts above this always need an admin signature, even with a server signer. */
const AUTO_PAYOUT_MAX = BigInt(process.env.AUTO_PAYOUT_MAX_LAMPORTS || 5_000_000_000);
const AUTO_DAILY_MAX = BigInt(process.env.AUTO_DAILY_MAX_LAMPORTS || 50_000_000_000);
const ENV_PAUSED = process.env.PAYOUTS_PAUSED === "1";

// ───── state (single process; every mutation goes through `mutate`) ─────

let state: State = emptyState();
let chain = Promise.resolve();

export async function loadState() {
  try { state = { ...emptyState(), ...JSON.parse(await fs.readFile(STATE_FILE, "utf8")) }; } catch { state = emptyState(); }
}
async function save() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state));
  await fs.rename(tmp, STATE_FILE);
}
/** Serialises all writers so two requests can never interleave a read-modify-write. */
function mutate<T>(fn: (s: State) => Promise<T> | T): Promise<T> {
  const run = chain.then(async () => { const r = await fn(state); await save(); return r; });
  chain = run.then(() => undefined, () => undefined);
  return run;
}
/** Append-only audit trail of every credit and payment. */
async function ledger(entry: Record<string, unknown>) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(LEDGER_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}
export async function readLedger(limit = 500) {
  try {
    const lines = (await fs.readFile(LEDGER_FILE, "utf8")).trim().split("\n");
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch { return []; }
}

export const isPaused = () => ENV_PAUSED || state.paused;
export const nowSec = () => Math.floor(Date.now() / 1000);
let hiddenCheck: (launch: string) => boolean = () => false;
export const setHiddenCheck = (fn: (launch: string) => boolean) => { hiddenCheck = fn; };

// ───── public views ─────

export function getLaunch(id: string) { return state.launches[id] ?? null; }

/** Shape the website expects (numbers in lamports and base units). */
export async function launchView(l: LaunchRec, withPool = true) {
  const b = buckets(state, l.id);
  const active = Object.values(state.orders).filter((o) => o.launch === l.id && (o.status === "active" || o.status === "settled"));
  const pool = withPool && l.pool ? await getPool(l.mint) : null;
  const prog = settleProgress(state, l.id);
  const c = l.clearing;
  const settled = Object.values(state.orders).filter((o) => o.launch === l.id && o.status === "settled");
  return {
    address: l.id, mint: l.mint, creator: l.creator, launchId: l.id, name: l.name, symbol: l.symbol,
    saleSupply: Number(l.saleSupply), creatorSupply: Number(l.creatorSupply), minPrice: Number(l.minPrice), maxPrice: Number(l.maxPrice),
    lpBps: l.lpBps, feeBps: l.feeBps, swapFeeBps: l.swapFeeBps, createdAt: l.createdAt, roadshowEnd: l.roadshowEnd, orderEnd: l.orderEnd,
    lockSecs: l.lockSecs, lockUntil: l.lockUntil,
    buckets: (c ? bucketsAtBell(l.id) : b).map(Number),
    totalBudget: Number((c ? bucketsAtBell(l.id) : b).reduce((x, y) => x + y, 0n)),
    orderCount: new Set((c ? settled : active).map((o) => o.buyer)).size,
    status: l.status,
    finalized: Boolean(c),
    clearingTick: c?.tick ?? 0, clearingPrice: Number(c?.price ?? 0), eligibleBudget: Number(c?.eligibleBudget ?? 0),
    soldValue: Number(c?.soldValue ?? 0), tokensSold: Number(c?.tokensSold ?? 0),
    creatorClaimed: Object.values(state.payouts).some((p) => p.launch === l.id && p.kind === "creator-release" && p.status === "done"),
    settle: prog,
    pool: l.pool ?? null,
    poolSol: pool?.sol ?? 0, poolTokens: pool?.tokens ?? 0, poolPrice: pool?.price ?? 0, volumeSol: 0,
  };
}
function bucketsAtBell(id: string) {
  const b = Array.from({ length: NUM_TICKS }, () => 0n);
  for (const o of Object.values(state.orders)) if (o.launch === id && o.status === "settled") b[o.maxTick] += BigInt(o.lamports);
  return b;
}

export async function listLaunches() {
  const ls = Object.values(state.launches).filter((l) => l.status !== "pending" && l.status !== "expired").sort((a, b) => b.createdAt - a.createdAt);
  return Promise.all(ls.map((l) => launchView(l)));
}

export const position = (launch: string, buyer: string) => buyerPosition(state, launch, buyer);

export function platform() {
  return {
    network: NETWORK,
    company: COMPANY?.toBase58() ?? null,
    feeBps: FEE_BPS, swapFeeBps: SWAP_FEE_BPS, minLockSecs: MIN_LOCK_SECS,
    listingFee: Number(LISTING_FEE_LAMPORTS), paused: isPaused(),
    payoutMode: serverSigner ? "automatic (with admin limits)" : "admin-signed",
    now: nowSec(),
  };
}

// ───── filing a listing ─────

export type FilingInput = {
  creator: string; name: string; symbol: string; saleSupply: string; creatorSupply: string; minPrice: string; maxPrice: string;
  lpBps: number; roadshowSecs: number; orderSecs: number; lockSecs: number;
};

export function validateFiling(f: FilingInput): string | null {
  if (!f.name || f.name.length > 32) return "Name must be 1–32 characters";
  if (!/^[A-Z0-9]{1,10}$/.test(f.symbol)) return "Ticker must be 1–10 letters or numbers";
  let sale: bigint, creator: bigint, min: bigint, max: bigint;
  try { sale = BigInt(f.saleSupply); creator = BigInt(f.creatorSupply); min = BigInt(f.minPrice); max = BigInt(f.maxPrice); } catch { return "Invalid numbers"; }
  if (sale <= 0n || sale > 10n ** 15n) return "Tokens for sale out of range";
  if (creator < 0n || creator > sale / 4n) return "Creator share can be at most 25% of the sale";
  if (min <= 0n || max < min) return "Max price must be at least the min price";
  if (!(f.lpBps >= 1000 && f.lpBps <= 5000)) return "Liquidity must be 10–50% of the raise";
  if (!(f.roadshowSecs >= 0 && f.orderSecs > 0 && f.roadshowSecs <= 30 * 86400 && f.orderSecs <= 30 * 86400)) return "Invalid schedule";
  if (!(f.lockSecs >= MIN_LOCK_SECS && f.lockSecs <= 5 * 365 * 86400)) return `Creator lockup must be at least ${Math.ceil(MIN_LOCK_SECS / 86400)} days`;
  return null;
}

/**
 * Builds the filing transaction for the creator to sign. The creator pays all rent and the listing
 * fee. They are mint authority only inside this one transaction, which hands it to the company wallet
 * before it ends, so nobody but the company can ever mint. No custom program involved.
 */
export async function prepareFiling(f: FilingInput, metadataUri: (mint: string) => string) {
  if (isPaused()) throw new Error("Stewra is paused. New listings are temporarily disabled.");
  const company = requireCompany();
  const creator = new PublicKey(f.creator);
  const mint = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction();
  tx.add(
    SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint.publicKey, 6, creator, null),
    createMetadataIx({ mint: mint.publicKey, mintAuthority: creator, payer: creator, updateAuthority: company, name: f.name, symbol: f.symbol, uri: metadataUri(mint.publicKey.toBase58()) }),
    createSetAuthorityInstruction(mint.publicKey, creator, AuthorityType.MintTokens, company),
    SystemProgram.transfer({ fromPubkey: creator, toPubkey: company, lamports: LISTING_FEE_LAMPORTS }),
    memoIx(fileMemo(mint.publicKey.toBase58())),
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = creator;
  tx.recentBlockhash = blockhash;
  tx.partialSign(mint);

  const id = mint.publicKey.toBase58();
  await mutate((s) => {
    s.launches[id] = {
      id, mint: id, creator: f.creator, name: f.name, symbol: f.symbol, saleSupply: f.saleSupply, creatorSupply: f.creatorSupply,
      minPrice: f.minPrice, maxPrice: f.maxPrice, lpBps: f.lpBps, feeBps: FEE_BPS, swapFeeBps: SWAP_FEE_BPS,
      roadshowSecs: f.roadshowSecs, orderSecs: f.orderSecs, lockSecs: f.lockSecs, status: "pending", preparedAt: nowSec(),
      createdAt: 0, roadshowEnd: 0, orderEnd: 0, lockUntil: 0,
    };
  });
  return { launch: id, lastValidBlockHeight, tx: tx.serialize({ requireAllSignatures: false }).toString("base64") };
}

/** Activates a filed listing once its mint exists on-chain with the company wallet as the only mint authority. */
export async function confirmFiling(id: string): Promise<LaunchRec | null> {
  const l = state.launches[id];
  if (!l) return null;
  if (l.status !== "pending") return l;
  const company = requireCompany();
  const [mintAcc, metaAcc] = await connection.getMultipleAccountsInfo([new PublicKey(id), metadataPda(new PublicKey(id))], "finalized");
  if (!mintAcc || !metaAcc) return l; // not landed (or not finalized) yet
  const mint = unpackMint(new PublicKey(id), mintAcc);
  const ok = mint.mintAuthority?.equals(company) && mint.supply === 0n && mint.decimals === 6 && mint.freezeAuthority === null
    && new PublicKey(metaAcc.data.subarray(1, 33)).equals(company);
  if (!ok) return l;
  return mutate(async (s) => {
    const cur = s.launches[id];
    if (cur.status !== "pending") return cur;
    const now = nowSec();
    cur.status = "live";
    cur.createdAt = now;
    cur.roadshowEnd = now + cur.roadshowSecs;
    cur.orderEnd = cur.roadshowEnd + cur.orderSecs;
    await ledger({ type: "listing", launch: id, creator: cur.creator, listingFee: LISTING_FEE_LAMPORTS.toString() });
    return cur;
  });
}

// ───── deposits ─────

async function fetchParsed(sig: string): Promise<ParsedTransactionWithMeta | null> {
  return connection.getParsedTransaction(sig, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
}

/** Credits one deposit by signature if it is finalized. Returns the outcome, or null if not finalized yet. */
export async function ingest(sig: string): Promise<string | null> {
  if (state.seen[sig]) return state.seen[sig];
  const company = requireCompany().toBase58();
  const tx = await fetchParsed(sig);
  if (!tx) return null; // unknown or not finalized: never credited early
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = classifyDeposit(sig, tx as any, company);
  if (!d) {
    await mutate((s) => { s.seen[sig] = "not-a-deposit"; });
    return "not-a-deposit";
  }
  return mutate(async (s) => {
    const outcome = applyDeposit(s, d, { hidden: hiddenCheck, now: nowSec() });
    if (outcome === "order" || outcome.startsWith("rejected")) {
      const o = s.orders[sig];
      await ledger({ type: outcome === "order" ? "deposit" : "deposit-rejected", sig, launch: o.launch, buyer: o.buyer, lamports: o.lamports, maxTick: o.maxTick, reason: o.reason });
    } else if (outcome === "unattributed") {
      await ledger({ type: "deposit-unattributed", sig, from: d.from, lamports: d.lamports.toString() });
    }
    return outcome;
  });
}

/** Walks the company wallet's history so deposits are credited even if the buyer's browser never reported them. */
async function scanDeposits() {
  const company = requireCompany();
  const sigs = await connection.getSignaturesForAddress(company, { until: state.cursor, limit: 500 }, "finalized");
  if (!sigs.length) return;
  for (const s of sigs.slice().reverse()) {
    if (s.err) { await mutate((st) => { st.seen[s.signature] ??= "failed-tx"; }); continue; }
    if (state.seen[s.signature]) continue;
    const outcome = await ingest(s.signature);
    if (outcome === null) return; // try again next round, don't move the cursor past it
  }
  await mutate((st) => { st.cursor = sigs[0].signature; });
}

// ───── cancellations ─────

export async function cancel(launch: string, buyer: string, ts: number, signature: string) {
  if (Math.abs(Date.now() - ts) > 5 * 60_000) return { error: "Signature expired. Try again." };
  let ok = false;
  try { ok = ed25519.verify(bs58.decode(signature), new TextEncoder().encode(cancelMessage(launch, ts)), new PublicKey(buyer).toBytes()); } catch { ok = false; }
  if (!ok) return { error: "Signature doesn't match your wallet" };
  return mutate(async (s) => {
    const r = cancelOrders(s, launch, buyer, nowSec());
    if (!r.error) await ledger({ type: "cancel", launch, buyer, lamports: r.refunded.toString() });
    return r.error ? { error: r.error } : { refunded: r.refunded.toString() };
  });
}

// ───── payouts ─────

const ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

async function buildPayout(p: Payout): Promise<Built> {
  const company = requireCompany();
  const to = new PublicKey(p.to);
  const memo = memoIx(`stewra:payout:${p.id}`);
  const lamports = BigInt(p.lamports), tokens = BigInt(p.tokens);
  // Refunds can belong to a listing that never existed (an order with a bad memo), so they don't touch it.
  if (p.kind === "refund" || p.kind === "fee" || p.kind === "creator-sol") {
    return { ixs: [SystemProgram.transfer({ fromPubkey: company, toPubkey: to, lamports }), memo] };
  }
  const l = state.launches[p.launch];
  const mint = new PublicKey(l.mint);
  switch (p.kind) {
    case "settle": {
      const ixs = [];
      if (tokens > 0n) {
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(company, ata(mint, to), to, mint));
        ixs.push(createMintToInstruction(mint, ata(mint, to), company, tokens));
      }
      if (lamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: company, toPubkey: to, lamports }));
      return { ixs: [...ixs, memo] };
    }
    case "creator-tokens":
    case "lp-mint":
      return { ixs: [
        createAssociatedTokenAccountIdempotentInstruction(company, ata(mint, company), company, mint),
        createMintToInstruction(mint, ata(mint, company), company, tokens), memo,
      ] };
    case "pool": {
      if (!p.secret) throw new Error("missing position key");
      const positionNft = Keypair.fromSecretKey(Uint8Array.from(p.secret));
      const built = await buildCreatePool({ mint, tokens, lamports, priceLamports: BigInt(l.clearing!.price), positionNft });
      return { ixs: [...built.ixs, memo], signers: built.signers };
    }
    case "revoke":
      return { ixs: [createSetAuthorityInstruction(mint, company, AuthorityType.MintTokens, null), memo] };
    case "creator-release":
      return { ixs: [
        createAssociatedTokenAccountIdempotentInstruction(company, ata(mint, to), to, mint),
        createTransferInstruction(ata(mint, company), ata(mint, to), company, tokens), memo,
      ] };
  }
}

function ready(p: Payout) {
  if (p.status !== "queued") return false;
  if (p.notBefore && nowSec() < p.notBefore) return false;
  return p.after.every((id) => state.payouts[id]?.status === "done");
}

const payoutOrder = (a: Payout, b: Payout) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

function autoSentToday() {
  const dayAgo = nowSec() - 86400;
  return Object.values(state.payouts).filter((p) => p.status === "done" && (p.doneAt ?? 0) > dayAgo && p.send.attempts && p.send.awaiting === undefined && (p as Payout & { auto?: boolean }).auto)
    .reduce((s, p) => s + BigInt(p.lamports), 0n);
}

async function markDone(p: Payout) {
  await mutate(async (s) => {
    const cur = s.payouts[p.id];
    if (cur.status === "done") return;
    cur.status = "done";
    cur.doneAt = nowSec();
    if (cur.kind === "pool") s.launches[cur.launch].pool = (await import("./meteora.js")).poolAddress(new PublicKey(s.launches[cur.launch].mint)).toBase58();
    await ledger({ type: `payout:${cur.kind}`, id: cur.id, launch: cur.launch, to: cur.to, lamports: cur.lamports, tokens: cur.tokens, sig: cur.send.sig });
    const l = s.launches[cur.launch];
    if (l?.status === "settling") {
      const prog = settleProgress(s, l.id);
      if (prog.done === prog.total) l.status = BigInt(l.clearing?.soldValue ?? 0) > 0n ? "trading" : "failed";
    }
  });
}

/** One pass over the queue: confirm what landed, and send what's ready if a server signer is allowed to. */
async function processPayouts() {
  if (isPaused()) return;
  let sent = 0;
  for (const p of Object.values(state.payouts).filter((x) => x.status === "queued").sort(payoutOrder)) {
    if (!ready(p)) continue;
    const st = await checkSent(p.send);
    if (st === "done") { await markDone(p); continue; }
    if (st === "pending") { await mutate(() => {}); continue; }
    // retry: only the server signer sends automatically, and only within limits
    if (!serverSigner || sent >= 4) continue;
    if (BigInt(p.lamports) > AUTO_PAYOUT_MAX || autoSentToday() + BigInt(p.lamports) > AUTO_DAILY_MAX) continue;
    try {
      if (p.kind === "pool" && !p.secret) await mutate((s) => { s.payouts[p.id].secret = Array.from(Keypair.generate().secretKey); });
      const { tx, lastValidBlockHeight } = await buildTx(await buildPayout(state.payouts[p.id]));
      tx.partialSign(serverSigner);
      await broadcast(state.payouts[p.id].send, tx, lastValidBlockHeight, () => mutate((s) => { (s.payouts[p.id] as Payout & { auto?: boolean }).auto = true; }));
      sent++;
    } catch (e) {
      await mutate((s) => {
        const cur = s.payouts[p.id];
        cur.send.attempts = (cur.send.attempts ?? 0) + 1;
        cur.send.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        if (cur.send.attempts >= 10) cur.status = "failed";
      });
    }
  }
}

// ───── admin-signed payouts (no private key on the server) ─────

export function payoutQueue() {
  const all = Object.values(state.payouts).sort(payoutOrder);
  const describe = (p: Payout) => ({
    id: p.id, kind: p.kind, launch: p.launch, symbol: state.launches[p.launch]?.symbol, to: p.to, lamports: p.lamports, tokens: p.tokens,
    status: p.status, ready: ready(p), notBefore: p.notBefore, sig: p.send.sig, awaiting: Boolean(p.send.awaiting), error: p.send.error, attempts: p.send.attempts ?? 0,
  });
  return {
    pending: all.filter((p) => p.status !== "done").map(describe),
    recent: all.filter((p) => p.status === "done").slice(-50).reverse().map(describe),
    unattributed: state.unattributed.slice(-100).reverse(),
  };
}

/** Builds up to `max` ready payouts for the company wallet to sign in the admin's browser. */
export async function buildForAdmin(max = 8) {
  if (isPaused()) throw new Error("Payouts are paused");
  const out: { id: string; kind: string; to: string; lamports: string; tokens: string; tx: string }[] = [];
  for (const p of Object.values(state.payouts).filter((x) => x.status === "queued").sort(payoutOrder)) {
    if (out.length >= max) break;
    if (!ready(p)) continue;
    const st = await checkSent(p.send);
    if (st === "done") { await markDone(p); continue; }
    if (st === "pending") continue;
    try {
      if (p.kind === "pool" && !p.secret) await mutate((s) => { s.payouts[p.id].secret = Array.from(Keypair.generate().secretKey); });
      const { tx, lastValidBlockHeight } = await buildTx(await buildPayout(state.payouts[p.id]));
      const message = tx.serializeMessage().toString("base64");
      await mutate((s) => { s.payouts[p.id].send.awaiting = message; s.payouts[p.id].send.lastValidBlockHeight = lastValidBlockHeight; s.payouts[p.id].send.error = undefined; });
      out.push({ id: p.id, kind: p.kind, to: p.to, lamports: p.lamports, tokens: p.tokens, tx: tx.serialize({ requireAllSignatures: false }).toString("base64") });
    } catch (e) {
      await mutate((s) => { s.payouts[p.id].send.error = (e instanceof Error ? e.message : String(e)).slice(0, 500); });
    }
  }
  return out;
}

/** Accepts signed transactions back. Only the exact message we built, signed by the company wallet, is broadcast. */
export async function submitFromAdmin(items: { id: string; tx: string }[]) {
  const results: { id: string; ok: boolean; sig?: string; error?: string }[] = [];
  for (const { id, tx: b64 } of items) {
    const p = state.payouts[id];
    try {
      if (!p || p.status !== "queued" || !p.send.awaiting) throw new Error("This payout isn't waiting for a signature. Build it again.");
      const tx = Transaction.from(Buffer.from(b64, "base64"));
      if (tx.serializeMessage().toString("base64") !== p.send.awaiting) throw new Error("Signed transaction doesn't match what the server built");
      await broadcast(p.send, tx, p.send.lastValidBlockHeight ?? 0, () => mutate(() => {}));
      results.push({ id, ok: true, sig: p.send.sig });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

export async function setPaused(paused: boolean, note = "") {
  await mutate(async (s) => { s.paused = paused; s.pauseNote = note; await ledger({ type: paused ? "pause" : "unpause", note }); });
}

/** Wallet balance against what's owed. */
export async function solvency() {
  const owed = liabilities(state);
  const balance = COMPANY ? BigInt(await connection.getBalance(COMPANY, "confirmed")) : 0n;
  return {
    balance: balance.toString(), openOrders: owed.openOrders.toString(), pendingPayouts: owed.pendingPayouts.toString(),
    owed: owed.total.toString(), surplus: (balance - owed.total).toString(),
  };
}

export const exportState = () => JSON.parse(JSON.stringify({ ...state, payouts: Object.fromEntries(Object.entries(state.payouts).map(([k, v]) => [k, { ...v, secret: undefined }])) }));

// ───── worker ─────

async function tick() {
  const now = nowSec();
  // Pending filings: activate when the mint lands, drop after 10 minutes.
  for (const l of Object.values(state.launches).filter((x) => x.status === "pending")) {
    if (now - l.preparedAt > 600) {
      const done = await confirmFiling(l.id);
      if (done?.status === "pending") await mutate((s) => { s.launches[l.id].status = "expired"; });
    } else await confirmFiling(l.id);
  }
  await scanDeposits();
  if (!isPaused()) {
    for (const l of Object.values(state.launches).filter((x) => x.status === "live" && now >= x.orderEnd + BELL_GRACE_SECS)) {
      await scanDeposits(); // last sweep so late orders are in the book
      await mutate(async (s) => {
        const c = ringBell(s, l.id, { treasury: (TREASURY ?? requireCompany()).toBase58(), company: requireCompany().toBase58(), now: nowSec() });
        await ledger({ type: "bell", launch: l.id, price: c.price.toString(), soldValue: c.soldValue.toString(), tokensSold: c.tokensSold.toString() });
        if (settleProgress(s, l.id).total === 0) s.launches[l.id].status = c.soldValue > 0n ? "trading" : "failed";
      });
    }
  }
  await processPayouts();
}

export function startWorker() {
  if (!COMPANY) { console.error("COMPANY_WALLET_ADDRESS missing: IPO engine not started"); return; }
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error("worker", e instanceof Error ? e.message : e); } finally { busy = false; }
  };
  setTimeout(run, 2000);
  setInterval(run, 8000).unref();
}

// Re-exports used by routes
export { cancelMessage, tickPrice, BPS, ONE_TOKEN };
