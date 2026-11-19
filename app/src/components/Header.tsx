"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { CLUSTER } from "@/lib/stewra";
import Faucet from "./Faucet";
import Logo from "./Logo";
import OpenInWallet from "./OpenInWallet";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

const LINKS = [
  { href: "/#listings", label: "Listings" },
  { href: "/how-to-use", label: "How to use" },
  { href: "/create", label: "File an IPO" },
];

export default function Header() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [path]);

  return (
    <header className={`nav ${scrolled ? "nav-scrolled" : ""}`}>
      <div className="nav-pill">
        <Logo />
        <nav className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "on" : ""}>{l.label}</Link>
          ))}
        </nav>
        <div className="nav-right">
          {CLUSTER === "localnet" && <Faucet />}
          <OpenInWallet />
          <WalletMultiButton />
          <button className="nav-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span /><span />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav
            className="nav-sheet"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
