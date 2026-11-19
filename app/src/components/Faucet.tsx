"use client";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CLUSTER } from "@/lib/stewra";

/** Local development only: airdrop SOL to the connected wallet. Never rendered on the live site. */
export default function Faucet() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  if (CLUSTER !== "localnet" || !publicKey) return null;
  return (
    <button className="btn sm" disabled={state === "busy"} title="Local development airdrop" onClick={async () => {
      setState("busy");
      try {
        const sig = await connection.requestAirdrop(publicKey, 20 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        setState("ok");
      } catch {
        setState("err");
      }
      setTimeout(() => setState("idle"), 2500);
    }}>
      {state === "busy" ? "Funding…" : state === "ok" ? "Funded ✓" : state === "err" ? "Faucet busy" : "Airdrop SOL"}
    </button>
  );
}
