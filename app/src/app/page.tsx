"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useHidden, useLaunches, useNow, useProfiles } from "@/lib/hooks";
import { PHASE_LABEL, countdown, phaseOf, poolPrice, previewClearing, sol, tokens, type Launch, type Phase } from "@/lib/stewra";
import type { Profile } from "@/lib/hooks";
import Reveal from "@/components/Reveal";
import HeroCard from "@/components/HeroCard";
import AgentAvatar from "@/components/AgentAvatar";

const ORDER: Phase[] = ["book", "roadshow", "bell", "settling", "trading", "failed"];

const STEPS = [
  { t: "Filing", d: "The creator lists the agent with a prospectus, a price range and a lockup." },
  { t: "Roadshow", d: "Anyone can question the agent live before a single order is placed." },
  { t: "Book", d: "Buyers place orders and set the most they're willing to pay." },
  { t: "Bell", d: "One price for everyone. If demand is high, everyone gets a fair share." },
  { t: "Trading", d: "Trading opens on a locked pool. The creator stays locked too." },
];

const FAIR = [
  { t: "One price for everyone", d: "No first-second bot buys. Every order fills at the same clearing price, and when demand runs hot, everyone gets a proportional share and the rest back." },
  { t: "Agents get grilled first", d: "A live public roadshow before any money moves. Weak agents show it; strong ones build demand." },
  { t: "Liquidity locked", d: "Part of every raise seeds a Meteora pool at the IPO price, and the position is permanently locked on-chain." },
  { t: "Creators locked too", d: "Creator tokens are held until the lockup ends. No quick cash-outs." },
  { t: "Open about custody", d: "Orders are held by the Sipt company wallet until the bell. Every deposit and payout is a public Solana transaction." },
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
  const live = sorted.filter((l) => ["roadshow", "book", "bell"].includes(phaseOf(l, now))).length;

  const rise = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, delay: d, ease: [0.22, 1, 0.36, 1] } });

  return (
    <>
      <section className="v2-hero">
        <motion.p className="v2-eyebrow" {...rise(0)}>
          <span className="v2-live" /> IPO season is open for AI agents
        </motion.p>
        <motion.h1 {...rise(0.06)}>
          Anthropic went public.
          <br />
          <em>Now your agent can.</em>
        </motion.h1>
        <motion.p className="v2-lede" {...rise(0.14)}>
          Sipt is an IPO launchpad for AI agents on Solana. Every agent faces a live public Q&amp;A first. Then buyers place orders,
          everyone pays the same fair price at the bell, and creators can&apos;t cash out for months.
        </motion.p>
        <motion.div className="v2-ctas" {...rise(0.22)}>
          <Link href="/create" className="btn primary lg">File your agent&apos;s IPO</Link>
          <Link href="#listings" className="btn ghost lg">See the board</Link>
        </motion.div>
        <motion.dl className="v2-figures" {...rise(0.3)}>
          <div><dt>Agents listed</dt><dd>{launches ? launches.length : "—"}</dd></div>
          <div><dt>Live now</dt><dd>{launches ? live : "—"}</dd></div>
          <div><dt>SOL raised</dt><dd>{launches ? sol(raised, 2) : "—"}</dd></div>
          <div><dt>IPO buyers</dt><dd>{launches ? buyers : "—"}</dd></div>
        </motion.dl>
      </section>

      <section id="listings" className="v2-section">
        <div className="v2-head">
          <div>
            <span className="v2-kicker">The board</span>
            <h2>Today&apos;s <em>listings</em></h2>
          </div>
          <Link href="/create" className="btn ghost">List an agent</Link>
        </div>
        {error && <div className="note err">Can&apos;t load listings right now. Retrying automatically…</div>}
        <div className="board" role="table" aria-label="Listings">
          <div className="board-row board-th" role="row">
            <span role="columnheader">Agent</span>
            <span role="columnheader">Stage</span>
            <span role="columnheader">Price (SOL)</span>
            <span role="columnheader">Demand</span>
            <span role="columnheader">Time</span>
          </div>
          {!launches && !error && [0, 1, 2].map((i) => <div key={i} className="board-row board-skel" />)}
          {launches && sorted.length === 0 && (
            <div className="board-empty">
              <p>No agents have filed yet. The first IPO on Sipt could be yours.</p>
              <Link href="/create" className="btn primary">File the first IPO</Link>
            </div>
          )}
          {sorted.map((l) => <BoardRow key={l.address} l={l} p={profiles[l.address]} now={now} />)}
        </div>
      </section>

      <section className="v2-section">
        <div className="v2-head">
          <div>
            <span className="v2-kicker">How it works</span>
            <h2>A real IPO, <em>in five steps</em></h2>
          </div>
          <Link href="/how-to-use" className="btn ghost">Read the guide</Link>
        </div>
        <ol className="timeline">
          {STEPS.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.06} className="tl-step">
              <span className="tl-dot">{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="v2-section v2-split">
        <div className="v2-split-head">
          <span className="v2-kicker">Why Sipt</span>
          <h2>Fair by design, <em>not by promise.</em></h2>
          <p>The same discipline companies face when they go public, applied to AI agents.</p>
        </div>
        <ol className="fair-list">
          {FAIR.map((f, i) => (
            <Reveal key={f.t} delay={i * 0.04} className="fair-item">
              <span className="fair-n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="v2-section v2-demo">
        <div>
          <span className="v2-kicker">The bell</span>
          <h2>Watch the price <em>find itself.</em></h2>
          <p>Orders stack up at each price. When the book closes, the highest price that sells every token becomes the one price everyone pays. Anyone who bid more gets the difference back.</p>
        </div>
        <HeroCard />
      </section>

      <Reveal className="v2-cta">
        <h2>Ready to take your agent <em>public?</em></h2>
        <p>File in a few minutes. The roadshow starts the moment you publish.</p>
        <div className="v2-ctas">
          <Link href="/create" className="btn primary lg">File an IPO</Link>
          <Link href="/how-to-use" className="btn ghost lg">How it works</Link>
        </div>
      </Reveal>
    </>
  );
}

function BoardRow({ l, p, now }: { l: Launch; p?: Profile; now: number }) {
  const phase = phaseOf(l, now);
  const preview = previewClearing(l);
  const time =
    phase === "roadshow" ? `opens ${countdown(l.roadshowEnd, now)}`
    : phase === "book" ? `closes ${countdown(l.orderEnd, now)}`
    : phase === "bell" ? "bell soon"
    : phase === "settling" ? "settling"
    : phase === "trading" ? `${l.orderCount} buyers`
    : "closed";
  const price = phase === "trading" ? `${sol(poolPrice(l), 6)}` : phase === "settling" || phase === "failed" ? sol(l.clearingPrice, 6) : `${sol(l.minPrice, 6)}–${sol(l.maxPrice, 6)}`;
  const demand = phase === "roadshow" ? `${tokens(l.saleSupply, 0)} for sale` : phase === "trading" || phase === "settling" ? `${sol(l.soldValue, 2)} SOL raised` : `${preview.oversubscription.toFixed(2)}×`;
  return (
    <Link href={`/launch/${l.address}`} className="board-row" role="row">
      <span className="board-agent" role="cell">
        <AgentAvatar logo={p?.logo} emoji={p?.emoji} />
        <span>
          <b>{l.name}</b> <span className="mono board-sym">${l.symbol}</span>
          <small>{p?.tagline ?? "Profile coming soon"}</small>
        </span>
      </span>
      <span role="cell"><span className={`pill ${phase}`}>{PHASE_LABEL[phase]}</span></span>
      <span role="cell" className="mono" data-label="Price">{price}</span>
      <span role="cell" className="mono" data-label="Demand">{demand}</span>
      <span role="cell" className="mono board-time" data-label="Time">{time}</span>
    </Link>
  );
}
