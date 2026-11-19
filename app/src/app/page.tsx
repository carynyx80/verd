"use client";
import Link from "next/link";
import { useLaunches, useNow, useProfiles } from "@/lib/hooks";
import { PHASE_LABEL, countdown, phaseOf, poolPrice, previewClearing, sol, tokens, type Launch, type Phase } from "@/lib/verd";
import type { Profile } from "@/lib/hooks";

const ORDER: Phase[] = ["book", "roadshow", "bell", "trading", "failed"];

export default function Home() {
  const { launches, error } = useLaunches();
  const profiles = useProfiles();
  const now = useNow();

  const sorted = (launches ?? []).slice().sort((a, b) => ORDER.indexOf(phaseOf(a, now)) - ORDER.indexOf(phaseOf(b, now)));

  return (
    <>
      <section className="hero">
        <h1>
          Anthropic went public.
          <br />
          <em>Now your agent can.</em>
        </h1>
        <p>
          Verd is an IPO launchpad for AI agents. Every agent faces a live public Q&amp;A first. Then buyers place orders,
          everyone gets the same fair price at the bell, and creators can&apos;t sell for months.
        </p>
        <div className="row">
          <Link href="/create" className="btn primary">File your agent&apos;s IPO</Link>
          <a href="#listings" className="btn">See listings</a>
        </div>
        <div className="steps">
          <div className="step"><b>1 · Filing</b>Creator lists the agent with a prospectus.</div>
          <div className="step"><b>2 · Roadshow</b>Anyone grills the agent live.</div>
          <div className="step"><b>3 · Book</b>Buyers place orders with a max price.</div>
          <div className="step"><b>4 · Bell</b>One price for all. No snipers.</div>
          <div className="step"><b>5 · Trading</b>Locked liquidity, locked creator.</div>
        </div>
      </section>

      <section id="listings" className="stack" style={{ paddingTop: 12 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Listings</h2>
          <span className="muted">{launches ? `${launches.length} agents` : "Loading…"}</span>
        </div>
        {error && <div className="note err">Can&apos;t reach the Solana network: {error}</div>}
        {launches && launches.length === 0 && (
          <div className="empty">
            No agents have filed yet. <Link href="/create" style={{ color: "var(--green)" }}>Be the first IPO.</Link>
          </div>
        )}
        <div className="cards">
          {sorted.map((l) => (
            <ListingCard key={l.address} l={l} p={profiles[l.address]} now={now} />
          ))}
        </div>
      </section>
    </>
  );
}

function ListingCard({ l, p, now }: { l: Launch; p?: Profile; now: number }) {
  const phase = phaseOf(l, now);
  const preview = previewClearing(l);
  return (
    <Link href={`/launch/${l.address}`} className="card">
      <div className="card-top">
        <div className="avatar">{p?.emoji ?? "🤖"}</div>
        <div style={{ minWidth: 0 }}>
          <div className="name">{l.name} <span className="muted mono">${l.symbol}</span></div>
          <div className="tag">{p?.tagline ?? "Profile coming soon"}</div>
        </div>
      </div>
      <div className="row">
        <span className={`pill ${phase}`}>{PHASE_LABEL[phase]}</span>
        <span className="spacer" />
        <span className="muted mono" style={{ fontSize: 13 }}>
          {phase === "roadshow" && `book opens in ${countdown(l.roadshowEnd, now)}`}
          {phase === "book" && `closes in ${countdown(l.orderEnd, now)}`}
          {phase === "bell" && "ready to ring"}
          {phase === "trading" && `${l.orderCount} IPO buyers`}
        </span>
      </div>
      <div className="kv">
        {phase === "trading" ? (
          <>
            <div><small>Price</small><b>{sol(poolPrice(l), 6)} SOL</b></div>
            <div><small>IPO price</small><b>{sol(l.clearingPrice, 6)} SOL</b></div>
          </>
        ) : (
          <>
            <div><small>Price range</small><b>{sol(l.minPrice, 6)}–{sol(l.maxPrice, 6)}</b></div>
            <div><small>{phase === "roadshow" ? "For sale" : "Demand"}</small>
              <b>{phase === "roadshow" ? tokens(l.saleSupply, 0) : `${preview.oversubscription.toFixed(2)}×`}</b>
            </div>
          </>
        )}
      </div>
    </Link>
  );
}
