"use client";
import { useEffect, useState } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";

/**
 * On a phone browser with no wallet available (typically iOS Safari/Chrome), offer to
 * reopen this page inside Phantom's in-app browser, where the wallet can connect.
 * Android is covered by the Mobile Wallet Adapter that ships with the wallet library.
 */
export default function OpenInWallet() {
  const { wallets, connected } = useWallet();
  const [href, setHref] = useState("");

  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const hasWallet = wallets.some((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
    if (!mobile || hasWallet || connected) return setHref("");
    const url = encodeURIComponent(window.location.href);
    const ref = encodeURIComponent(window.location.origin);
    setHref(`https://phantom.app/ul/browse/${url}?ref=${ref}`);
  }, [wallets, connected]);

  if (!href) return null;
  return <a className="btn sm" href={href}>Open in Phantom</a>;
}
