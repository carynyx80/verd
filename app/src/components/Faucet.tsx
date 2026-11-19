"use client";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CLUSTER } from "@/lib/verd";

/** Test networks only: request free test SOL for the connected wallet. */
export default function Faucet() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  if (CLUSTER === "mainnet-beta" || !publicKey) return null;
  return (
    <button className="btn sm" disabled={state === "busy"} title="Free test SOL (test networks only)" onClick={async () => {
      setState("busy");
      try {
        const sig = await connection.requestAirdrop(publicKey, (CLUSTER === "localnet" ? 20 : 1) * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        setState("ok");
      } catch {
        setState("err");
      }
      setTimeout(() => setState("idle"), 2500);
    }}>
      {state === "busy" ? "Funding…" : state === "ok" ? "Funded ✓" : state === "err" ? "Faucet busy" : "Get test SOL"}
    </button>
  );
}
