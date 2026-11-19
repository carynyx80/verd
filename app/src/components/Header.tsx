"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { CLUSTER } from "@/lib/verd";
import Faucet from "./Faucet";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function Header() {
  return (
    <header className="hdr">
      <div className="wrap hdr-in">
        <Link href="/" className="logo">verd<span>.ink</span></Link>
        <nav>
          <Link href="/">Listings</Link>
          <Link href="/create">File an IPO</Link>
        </nav>
        <div className="hdr-right">
          {CLUSTER !== "mainnet-beta" && <span className="net">{CLUSTER}</span>}
          <Faucet />
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
