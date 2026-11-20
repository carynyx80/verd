import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/** Solana network the site and wallets target. Production: mainnet-beta. */
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_NETWORK || process.env.NEXT_PUBLIC_CLUSTER || "mainnet-beta";
const DEFAULT_RPC: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};
/** Base URL of the Stewra backend (Railway). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
/**
 * RPC the browser uses. On mainnet this defaults to the backend relay: Solana's public mainnet RPC
 * refuses browser requests, and a paid RPC key must not ship to browsers.
 */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || (CLUSTER === "mainnet-beta" ? `${API_URL}/rpc` : DEFAULT_RPC[CLUSTER] || `${API_URL}/rpc`);
/** Explorer links always use the public cluster, never the relay. */
const EXPLORER_CLUSTER = CLUSTER;
export const api = (path: string) => `${API_URL}${path}`;
/** Public URL of an uploaded image (logo or banner). */
export const imageUrl = (id: string) => `${API_URL}/uploads/${id}`;
/** The company wallet built into this frontend. Orders are refused if the server reports a different one. */
export const COMPANY_WALLET = process.env.NEXT_PUBLIC_COMPANY_WALLET_ADDRESS || "jdceA46wcDNdk2SSZoZTz3MWdM95n94Fh8EXPQQrR21";

export const ONE_TOKEN = 1_000_000; // 10^6 base units
export const NUM_TICKS = 10;
export const BPS = 10_000;

// ───── listing shape served by the backend (numbers in lamports / base units) ─────

export type LaunchStatus = "live" | "settling" | "trading" | "failed";

export type Launch = {
  address: string; // = token mint
  creator: string;
  mint: string;
  launchId: string;
  name: string;
  symbol: string;
  saleSupply: number;
  creatorSupply: number;
  minPrice: number; // lamports per whole token
  maxPrice: number;
  lpBps: number;
  feeBps: number;
  swapFeeBps: number;
  createdAt: number;
  roadshowEnd: number;
  orderEnd: number;
  lockSecs: number;
  lockUntil: number;
  buckets: number[];
  totalBudget: number;
  orderCount: number;
  status: LaunchStatus;
  finalized: boolean;
  clearingTick: number;
  clearingPrice: number;
  eligibleBudget: number;
  soldValue: number;
  tokensSold: number;
  creatorClaimed: boolean;
  settle: { total: number; done: number };
  pool: string | null;
  poolSol: number;
  poolTokens: number;
  poolPrice: number;
  volumeSol: number;
};

export async function fetchLaunches(): Promise<Launch[]> {
  const r = await fetch(api("/api/launches"), { cache: "no-store" });
  if (!r.ok) throw new Error("Couldn't load listings");
  return r.json();
}

export async function fetchLaunch(address: string): Promise<Launch | null> {
  const r = await fetch(api(`/api/launches/${address}`), { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Couldn't load listing");
  return r.json();
}

/** Memo that attributes a deposit to a listing and a max price. Must match the server. */
export const orderMemo = (launch: string, tick: number) => `stewra:order:${launch}:${tick}`;
export const cancelMessage = (launch: string, ts: number) => `Stewra: cancel my orders\nlaunch: ${launch}\nts: ${ts}`;

// ───── phases ─────

export type Phase = "roadshow" | "book" | "bell" | "settling" | "trading" | "failed";

export function phaseOf(l: Launch, now = Date.now() / 1000): Phase {
  if (l.status === "trading") return "trading";
  if (l.status === "failed") return "failed";
  if (l.status === "settling") return "settling";
  if (now < l.roadshowEnd) return "roadshow";
  if (now < l.orderEnd) return "book";
  return "bell";
}

export const PHASE_LABEL: Record<Phase, string> = {
  roadshow: "Roadshow",
  book: "Book open",
  bell: "Bell soon",
  settling: "Settling",
  trading: "Trading",
  failed: "No demand",
};

// ───── auction math (mirrors the server) ─────

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

/** Current pool price in lamports per whole token. */
export const poolPrice = (l: Launch) => l.poolPrice || (l.poolTokens ? (l.poolSol / l.poolTokens) * ONE_TOKEN : 0);

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

export function explorerAddress(addr: string) {
  return explorerTx(addr).replace("/tx/", "/address/");
}

export function explorerTx(sig: string) {
  const c = EXPLORER_CLUSTER === "mainnet-beta" ? "" : EXPLORER_CLUSTER === "localnet" ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}` : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${sig}${c}`;
}

/** Message the creator signs to prove they own a launch when saving its profile. */
export const profileMessage = (launch: string, digest: string) =>
  `Stewra: publish agent profile\nlaunch: ${launch}\ndigest: ${digest}`;
