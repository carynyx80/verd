"use client";
import { useState } from "react";
import { explorerTx } from "./verd";

export type TxState = { kind: "idle" } | { kind: "pending"; label: string } | { kind: "ok"; label: string; sig?: string } | { kind: "err"; message: string };

/** Turn Anchor / wallet errors into one readable line. */
export function friendlyError(e: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyE = e as any;
  const code = anyE?.error?.errorMessage || anyE?.errorMessage;
  if (code) return code;
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected/i.test(msg)) return "You cancelled the transaction in your wallet.";
  if (/insufficient (funds|lamports)/i.test(msg) || /0x1\b/.test(msg)) return "Not enough SOL in your wallet for this.";
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
