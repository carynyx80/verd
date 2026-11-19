import { AnchorProvider, BN, Program } from "@anchor-lang/core";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import idl from "@/idl/verd.json";
import type { Verd } from "@/idl/verd";

export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER || "localnet";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
/** Base URL of the Stewra backend (Railway). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
export const api = (path: string) => `${API_URL}${path}`;
/** Public URL of an uploaded image (logo or banner). */
export const imageUrl = (id: string) => `${API_URL}/uploads/${id}`;

export const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || (idl as { address: string }).address);

export const ONE_TOKEN = 1_000_000; // 10^6 base units
export const NUM_TICKS = 10;
export const BPS = 10_000;

type IdlWithAddress = Verd & { address: string };

/** Read-only wallet so pages can fetch accounts before anyone connects. */
export type SignerWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
};

class ReadonlyWallet implements SignerWallet {
  payer = Keypair.generate();
  publicKey = this.payer.publicKey;
  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error("Connect a wallet first");
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error("Connect a wallet first");
  }
}

export function getProgram(connection: Connection, wallet?: SignerWallet | null): Program<Verd> {
  const provider = new AnchorProvider(connection, (wallet ?? new ReadonlyWallet()) as ConstructorParameters<typeof AnchorProvider>[1], { commitment: "confirmed" });
  const withAddr = { ...(idl as IdlWithAddress), address: PROGRAM_ID.toBase58() };
  return new Program<Verd>(withAddr as Verd, provider);
}

const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = () => pda([Buffer.from("config")]);
export const launchPda = (creator: PublicKey, id: BN) =>
  pda([Buffer.from("launch"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)]);
export const mintPda = (launch: PublicKey) => pda([Buffer.from("mint"), launch.toBuffer()]);
export const orderPda = (launch: PublicKey, buyer: PublicKey) =>
  pda([Buffer.from("order"), launch.toBuffer(), buyer.toBuffer()]);

// ───── account shapes (numbers converted for UI use) ─────

export type Launch = {
  address: string;
  creator: string;
  mint: string;
  launchId: string;
  name: string;
  symbol: string;
  saleSupply: number; // base units
  creatorSupply: number;
  minPrice: number; // lamports per token
  maxPrice: number;
  lpBps: number;
  feeBps: number;
  createdAt: number;
  roadshowEnd: number;
  orderEnd: number;
  lockSecs: number;
  lockUntil: number;
  buckets: number[]; // lamports per tick
  totalBudget: number;
  orderCount: number;
  finalized: boolean;
  clearingTick: number;
  clearingPrice: number;
  eligibleBudget: number;
  soldValue: number;
  tokensSold: number;
  creatorClaimed: boolean;
  poolSol: number;
  poolTokens: number;
  volumeSol: number;
};

const n = (v: BN | number) => (typeof v === "number" ? v : Number(v.toString()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toLaunch(address: PublicKey, a: any): Launch {
  return {
    address: address.toBase58(),
    creator: a.creator.toBase58(),
    mint: a.mint.toBase58(),
    launchId: a.launchId.toString(),
    name: a.name,
    symbol: a.symbol,
    saleSupply: n(a.saleSupply),
    creatorSupply: n(a.creatorSupply),
    minPrice: n(a.minPrice),
    maxPrice: n(a.maxPrice),
    lpBps: a.lpBps,
    feeBps: a.feeBps,
    createdAt: n(a.createdAt),
    roadshowEnd: n(a.roadshowEnd),
    orderEnd: n(a.orderEnd),
    lockSecs: n(a.lockSecs),
    lockUntil: n(a.lockUntil),
    buckets: a.bucketBudget.map(n),
    totalBudget: n(a.totalBudget),
    orderCount: a.orderCount,
    finalized: a.finalized,
    clearingTick: a.clearingTick,
    clearingPrice: n(a.clearingPrice),
    eligibleBudget: n(a.eligibleBudget),
    soldValue: n(a.soldValue),
    tokensSold: n(a.tokensSold),
    creatorClaimed: a.creatorClaimed,
    poolSol: n(a.poolSol),
    poolTokens: n(a.poolTokens),
    volumeSol: n(a.volumeSol),
  };
}

export async function fetchLaunches(connection: Connection): Promise<Launch[]> {
  const program = getProgram(connection);
  const all = await program.account.launch.all();
  return all.map((x) => toLaunch(x.publicKey, x.account)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function fetchLaunch(connection: Connection, address: string): Promise<Launch | null> {
  const program = getProgram(connection);
  const key = new PublicKey(address);
  const a = await program.account.launch.fetchNullable(key);
  return a ? toLaunch(key, a) : null;
}

// ───── phases ─────

export type Phase = "roadshow" | "book" | "bell" | "trading" | "failed";

export function phaseOf(l: Launch, now = Date.now() / 1000): Phase {
  if (l.finalized) return l.soldValue > 0 ? "trading" : "failed";
  if (now < l.roadshowEnd) return "roadshow";
  if (now < l.orderEnd) return "book";
  return "bell";
}

export const PHASE_LABEL: Record<Phase, string> = {
  roadshow: "Roadshow",
  book: "Book open",
  bell: "Bell ready",
  trading: "Trading",
  failed: "No demand",
};

// ───── auction math (mirrors the on-chain program) ─────

export function tickPrice(l: Pick<Launch, "minPrice" | "maxPrice">, tick: number): number {
  return l.minPrice + Math.floor(((l.maxPrice - l.minPrice) * tick) / (NUM_TICKS - 1));
}

export type ClearingPreview = { tick: number; price: number; oversubscription: number; filled: boolean };

/** What the clearing price would be if the bell rang right now. */
export function previewClearing(l: Launch): ClearingPreview {
  let cum = 0;
  for (let k = NUM_TICKS - 1; k >= 0; k--) {
    cum += l.buckets[k];
    const price = tickPrice(l, k);
    const demand = (cum * ONE_TOKEN) / price;
    if (demand >= l.saleSupply) {
      return { tick: k, price, oversubscription: demand / l.saleSupply, filled: true };
    }
  }
  const demand = (l.totalBudget * ONE_TOKEN) / l.minPrice;
  return { tick: 0, price: l.minPrice, oversubscription: demand / l.saleSupply, filled: false };
}

/** Cumulative demand (tokens) at each tick price — for the book chart. */
export function demandCurve(l: Launch): { tick: number; price: number; demand: number }[] {
  const out: { tick: number; price: number; demand: number }[] = [];
  let cum = 0;
  for (let k = NUM_TICKS - 1; k >= 0; k--) {
    cum += l.buckets[k];
    const price = tickPrice(l, k);
    out.unshift({ tick: k, price, demand: (cum * ONE_TOKEN) / price });
  }
  return out;
}

export function allocationFor(l: Launch, budget: number, maxTick: number): { spent: number; tokens: number } {
  if (!l.finalized || l.soldValue === 0 || maxTick < l.clearingTick || l.eligibleBudget === 0) return { spent: 0, tokens: 0 };
  const spent = Math.min(budget, Math.ceil((budget * l.soldValue) / l.eligibleBudget));
  return { spent, tokens: Math.floor((spent * ONE_TOKEN) / l.clearingPrice) };
}

export function quoteSwap(l: Launch, amountIn: number, buy: boolean, swapFeeBps: number): number {
  const x = l.poolSol, y = l.poolTokens;
  if (!x || !y || amountIn <= 0) return 0;
  if (buy) {
    const net = amountIn - Math.floor((amountIn * swapFeeBps) / BPS);
    return Math.floor((y * net) / (x + net));
  }
  const gross = Math.floor((x * amountIn) / (y + amountIn));
  return gross - Math.floor((gross * swapFeeBps) / BPS);
}

export const poolPrice = (l: Launch) => (l.poolTokens ? (l.poolSol / l.poolTokens) * ONE_TOKEN : 0);

// ───── formatting ─────

export const sol = (lamports: number, digits = 4) =>
  (lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: digits });
export const tokens = (base: number, digits = 2) =>
  (base / ONE_TOKEN).toLocaleString(undefined, { maximumFractionDigits: digits });
export const short = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

export function countdown(target: number, now = Date.now() / 1000): string {
  let s = Math.max(0, Math.floor(target - now));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export function explorerTx(sig: string) {
  const c = CLUSTER === "mainnet-beta" ? "" : CLUSTER === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}` : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${sig}${c}`;
}

/** Message the creator signs to prove they own a launch when saving its profile. */
export const profileMessage = (launch: string, digest: string) =>
  `Stewra: publish agent profile\nlaunch: ${launch}\ndigest: ${digest}`;
