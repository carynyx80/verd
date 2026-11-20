"use client";
import Link from "next/link";
import { useLaunches, useNow } from "@/lib/hooks";
import { PHASE_LABEL, phaseOf, poolPrice, previewClearing, sol } from "@/lib/stewra";

const IDLE = ["IPO season is open", "Live roadshow before every sale", "One price for everyone at the bell", "Pool liquidity locked", "Creators locked for months"];

/** Exchange-style tape under the header: live listings, or the product's promises when the board is empty. */
export default function Ticker() {
  const { launches } = useLaunches(15000);
  const now = useNow(5000);
  const items = (launches ?? []).slice(0, 12).map((l) => {
    const phase = phaseOf(l, now);
    const figure = phase === "trading" ? `${sol(poolPrice(l), 6)} SOL` : phase === "book" || phase === "bell" ? `${previewClearing(l).oversubscription.toFixed(2)}×` : `${sol(l.minPrice, 6)}–${sol(l.maxPrice, 6)}`;
    return { key: l.address, href: `/launch/${l.address}`, sym: `$${l.symbol}`, stage: PHASE_LABEL[phase], figure, phase };
  });
  const idle = IDLE.map((t) => ({ key: t, href: "/how-to-use", sym: "", stage: t, figure: "", phase: "idle" }));
  // Mix listings with the product's promises so the tape is always full, even with one listing.
  const base = items.length < 5 ? [...items, ...idle] : items;
  const row = Array.from({ length: Math.ceil(10 / base.length) }, () => base).flat();
  const loop = [...row, ...row]; // two identical halves for a seamless marquee

  return (
    <div className="ticker" aria-label="Live listings">
      <div className="ticker-track">
        {loop.map((it, i) => (
          <Link key={`${it.key}-${i}`} href={it.href} className={`ticker-item t-${it.phase}`} tabIndex={i < row.length ? 0 : -1} aria-hidden={i >= row.length}>
            {it.sym && <b className="mono">{it.sym}</b>}
            <span>{it.stage}</span>
            {it.figure && <span className="mono">{it.figure}</span>}
            <i aria-hidden>•</i>
          </Link>
        ))}
      </div>
    </div>
  );
}
