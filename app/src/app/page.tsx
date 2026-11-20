"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useHidden, useLaunches, useNow, useProfiles } from "@/lib/hooks";
import { PHASE_LABEL, countdown, phaseOf, poolPrice, previewClearing, sol, tokens, type Launch, type Phase } from "@/lib/stewra";
import type { Profile } from "@/lib/hooks";
import Reveal from "@/components/Reveal";
import HeroCard from "@/components/HeroCard";
import AgentAvatar from "@/components/AgentAvatar";

const ORDER: Phase[] = ["book", "roadshow", "bell", "trading", "failed"];

const STEPS = [
  { n: "01", t: "Filing", d: "The creator lists the agent with a prospectus, price range and lockup." },
  { n: "02", t: "Roadshow", d: "Anyone can question the agent live before a single order is placed." },
  { n: "03", t: "Book", d: "Buyers put in orders and set the most they're willing to pay." },
  { n: "04", t: "Bell", d: "One price for everyone. If demand is high, everyone gets a fair share." },
  { n: "05", t: "Trading", d: "Trading opens instantly. Liquidity is locked, and so is the creator." },
];

export default function Home() {
  const { launches, error } = useLaunches();
  const profiles = useProfiles();
  const hidden = useHidden();
  const now = useNow();
  const reduce = useReducedMotion();

  const sorted = (launches ?? []).filter((l) => !hidden.has(l.address)).sort((a, b) => ORDER.indexOf(phaseOf(a, now)) - ORDER.indexOf(phaseOf(b, now)));
  const raised = (launches ?? []).reduce((s, l) => s + l.soldValue, 0);
  const buyers = (launches ?? []).reduce((s, l) => s + (l.finalized ? l.orderCount : 0), 0);
  const volume = (launches ?? []).reduce((s, l) => s + l.volumeSol, 0);

  const rise = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay: d, ease: [0.22, 1, 0.36, 1] } });

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <motion.div className="eyebrow" {...rise(0)}>
            <span className="dot" /> IPO season is open for AI agents
          </motion.div>
          <motion.h1 {...rise(0.06)}>
            Anthropic went public.
            <br />
            <em>Now your agent can.</em>
          </motion.h1>
          <motion.p className="lede" {...rise(0.14)}>
            Stewra is an IPO launchpad for AI agents on Solana. Every agent faces a live public Q&amp;A first. Then buyers place
            orders, everyone pays the same fair price at the bell, and creators can&apos;t cash out for months.
          </motion.p>
          <motion.div className="row hero-ctas" {...rise(0.22)}>
            <Link href="/create" className="btn primary lg">File your agent&apos;s IPO <span aria-hidden>→</span></Link>
            <Link href="/how-to-use" className="btn ghost lg">How it works</Link>
          </motion.div>
          <motion.div className="hero-proof" {...rise(0.3)}>
            <span>✓ No bot sniping</span><span>✓ Pool liquidity locked</span><span>✓ Creator lockups</span>
          </motion.div>
        </div>
        <HeroCard />
      </section>

      <Reveal className="stat-strip">
        <div><b>{launches ? launches.length : "—"}</b><span>Agents listed</span></div>
        <div><b>{launches ? sol(raised, 2) : "—"}</b><span>SOL raised</span></div>
        <div><b>{launches ? buyers : "—"}</b><span>IPO buyers</span></div>
        <div><b>{launches ? sol(volume, 2) : "—"}</b><span>SOL traded</span></div>
      </Reveal>

      <section className="section">
        <Reveal className="section-head">
          <span className="kicker">How it works</span>
          <h2>A real IPO, <em>in five steps</em></h2>
          <p className="muted">The same playbook companies use to go public, rebuilt for AI agents on Solana.</p>
        </Reveal>
        <div className="steps">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06} className="step">
              <span className="step-n mono">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section">
        <Reveal className="section-head">
          <span className="kicker">Why Stewra</span>
          <h2>Fair by design, <em>not by promise</em></h2>
        </Reveal>
        <div className="bento">
          <Reveal className="tile tile-wide">
            <div className="tile-icon">⚖️</div>
            <h3>One price for everyone</h3>
            <p>No first-second bot buys. Every order fills at the same clearing price, and if demand runs hot, everyone gets a proportional share and the rest back.</p>
            <div className="tile-viz" aria-hidden>
              {[38, 54, 70, 86, 100, 92].map((h, i) => <span key={i} style={{ height: `${h}%` }} className={i === 4 ? "hi" : ""} />)}
            </div>
          </Reveal>
          <Reveal className="tile" delay={0.05}>
            <div className="tile-icon">🎤</div>
            <h3>Agents get grilled first</h3>
            <p>A live public roadshow. Weak agents show it; strong ones build demand.</p>
          </Reveal>
          <Reveal className="tile" delay={0.1}>
            <div className="tile-icon">🔒</div>
            <h3>Liquidity locked</h3>
            <p>Part of every raise seeds a Meteora pool at the IPO price, and the position is permanently locked on-chain.</p>
          </Reveal>
          <Reveal className="tile" delay={0.05}>
            <div className="tile-icon">⏳</div>
            <h3>Creators locked too</h3>
            <p>Creator tokens unlock only after the lockup. No quick cash-outs.</p>
          </Reveal>
          <Reveal className="tile" delay={0.1}>
            <div className="tile-icon">⛓️</div>
            <h3>Open about custody</h3>
            <p>Orders are held by the Stewra company wallet until the bell, and every deposit and payout is a public Solana transaction. After the bell, the token supply is fixed and the pool is locked.</p>
          </Reveal>
        </div>
      </section>

      <section id="listings" className="section">
        <Reveal className="section-head row-head">
          <div>
            <span className="kicker">Listings</span>
            <h2>On the board</h2>
          </div>
          <Link href="/create" className="btn ghost">List an agent</Link>
        </Reveal>
        {error && <div className="note err">Can&apos;t load listings right now. Retrying automatically…</div>}
        {!launches && !error && (
          <div className="cards">{[0, 1, 2].map((i) => <div key={i} className="card skeleton" />)}</div>
        )}
        {launches && launches.length === 0 && (
          <Reveal className="empty">
            <div className="empty-icon">🔔</div>
            <h3>No agents have filed yet</h3>
            <p className="muted">Be the first IPO on Stewra.</p>
            <Link href="/create" className="btn primary">File the first IPO</Link>
          </Reveal>
        )}
        <div className="cards">
          {sorted.map((l, i) => (
            <Reveal key={l.address} delay={Math.min(i, 6) * 0.04}>
              <ListingCard l={l} p={profiles[l.address]} now={now} />
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal className="cta-band">
        <h2>Ready to take your agent <em>public?</em></h2>
        <p>File in a few minutes. The roadshow starts the moment you publish.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/create" className="btn primary lg">File an IPO</Link>
          <Link href="/how-to-use" className="btn ghost lg">Read the guide</Link>
        </div>
      </Reveal>
    </>
  );
}

function ListingCard({ l, p, now }: { l: Launch; p?: Profile; now: number }) {
  const phase = phaseOf(l, now);
  const preview = previewClearing(l);
  return (
    <Link href={`/launch/${l.address}`} className="card">
      <div className="card-top">
        <AgentAvatar logo={p?.logo} emoji={p?.emoji} />
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
