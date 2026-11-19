// Admin actions are authorised by a wallet signature, not a password.
// The admin signs "Stewra admin\naction: <action>\nlaunch: <launch>\nts: <ms>" in their wallet;
// we verify it against ADMIN_WALLETS and reject anything older than 5 minutes or reused.
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

const ADMINS = (process.env.ADMIN_WALLETS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_AGE_MS = 5 * 60_000;
const seen = new Map<string, number>(); // signature -> expiry, prevents replay within the window

export const adminMessage = (action: string, launch: string, ts: number) =>
  `Stewra admin\naction: ${action}\nlaunch: ${launch}\nts: ${ts}`;

export function adminsConfigured() {
  return ADMINS.length > 0;
}

export function verifyAdmin(body: { wallet?: string; signature?: string; ts?: number; action?: string; launch?: string }): string | null {
  const { wallet, signature, ts, action, launch = "" } = body ?? {};
  if (!wallet || !signature || typeof ts !== "number" || !action) return "Missing admin signature";
  if (!ADMINS.includes(wallet)) return "This wallet isn't an admin";
  if (Math.abs(Date.now() - ts) > MAX_AGE_MS) return "Signature expired. Sign again.";
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k);
  if (seen.has(signature)) return "Signature already used. Sign again.";
  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(signature), new TextEncoder().encode(adminMessage(action, launch, ts)), new PublicKey(wallet).toBytes());
  } catch {
    ok = false;
  }
  if (!ok) return "Invalid admin signature";
  seen.set(signature, now + MAX_AGE_MS);
  return null;
}
