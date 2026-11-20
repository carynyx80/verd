"use client";
import { useState } from "react";
import type { Connection } from "@solana/web3.js";
import { explorerTx } from "./stewra";

/** Waits for a signature by polling (works through the HTTP-only RPC relay). Throws if it failed on-chain. */
export async function confirmSig(connection: Connection, sig: string, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const st = (await connection.getSignatureStatuses([sig]).catch(() => null))?.value[0];
    if (st?.err) throw new Error("The transaction failed on-chain. Nothing was charged except the network fee.");
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("The transaction took too long to confirm. Check your wallet history before retrying.");
}

export type TxState = { kind: "idle" } | { kind: "pending"; label: string } | { kind: "ok"; label: string; sig?: string } | { kind: "err"; message: string };

/** Turn Anchor / wallet errors into one readable line. */
export function friendlyError(e: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyE = e as any;
  const code = anyE?.error?.errorMessage || anyE?.errorMessage;
  if (code) return code;
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected/i.test(msg)) return "You cancelled the transaction in your wallet.";
  if (/insufficient (funds|lamports)/i.test(msg) || /0x1\b/.test(msg) || /no record of a prior credit/i.test(msg) || /AccountNotFound/i.test(msg))
    return "Your wallet doesn't have enough SOL for this.";
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) return "The transaction took too long to confirm. Try again.";
  if (/simulation failed|reverted/i.test(msg)) return "The transaction couldn't be completed. Check your wallet has SOL and try again.";
  if (/WalletNotConnected|not connected/i.test(msg)) return "Connect your wallet first.";
  const m = msg.match(/Error Message: ([^.]+)/);
  return m ? m[1] : msg.slice(0, 200);
}

export function useTx() {
  const [state, setState] = useState<TxState>({ kind: "idle" });
  async function run(label: string, fn: () => Promise<string | void>, done?: string) {
    setState({ kind: "pending", label });
    try {
      const sig = await fn();
      setState({ kind: "ok", label: done ?? "Done", sig: sig || undefined });
      return true;
    } catch (e) {
      console.error(e);
      setState({ kind: "err", message: friendlyError(e) });
      return false;
    }
  }
  return { state, run, reset: () => setState({ kind: "idle" }) };
}

export function TxNote({ state }: { state: TxState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "pending") return <div className="note">{state.label}…</div>;
  if (state.kind === "err") return <div className="note err">{state.message}</div>;
  return (
    <div className="note ok">
      {state.label}
      {state.sig && (
        <>
          {" · "}
          <a href={explorerTx(state.sig)} target="_blank" rel="noreferrer">view transaction</a>
        </>
      )}
    </div>
  );
}
