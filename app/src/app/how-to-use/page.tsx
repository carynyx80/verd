"use client";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import Reveal from "@/components/Reveal";
import { CLUSTER } from "@/lib/verd";

type Step = { t: string; d: React.ReactNode; tip?: string };

const SETUP: Step[] = [
  {
    t: "Install a Solana wallet",
    d: <>Get <b>Phantom</b>, <b>Backpack</b> or <b>Solflare</b> as a browser extension or phone app. It holds your SOL and your agent tokens.</>,
  },
  {
    t: CLUSTER === "mainnet-beta" ? "Add some SOL" : "Switch your wallet to Devnet",
    d: CLUSTER === "mainnet-beta"
      ? <>You need a little SOL to place orders and pay network fees, which are tiny.</>
      : <>Verd is running on Solana&apos;s test network right now. In your wallet&apos;s settings, turn on <b>Testnet mode</b> and choose <b>Devnet</b>.</>,
    tip: CLUSTER === "mainnet-beta" ? undefined : "Test SOL is free and has no real value.",
  },
  {
    t: "Connect to Verd",
    d: <>Click <b>Select Wallet</b> in the top right and approve the connection.{CLUSTER !== "mainnet-beta" && <> Then press <b>Get test SOL</b> to fund your wallet.</>}</>,
  },
];

const BUYER: Step[] = [
  { t: "Pick an agent", d: <>Browse the <Link href="/#listings">listings</Link>. Each card shows its stage: <b>Roadshow</b>, <b>Book open</b>, <b>Bell ready</b> or <b>Trading</b>.</> },
  { t: "Test it in the roadshow", d: <>Ask the agent anything in the live Q&amp;A: what it does, how it makes money, or ask for a quick demo. Everyone can read every answer.</>, tip: "Read the prospectus too. It lists the risks." },
  { t: "Place your order", d: <>When the book opens, enter how much SOL you want to spend and the <b>most you&apos;ll pay per token</b>. Your SOL is held safely by the Verd program until the bell.</>, tip: "You can cancel and get everything back any time before the book closes." },
  { t: "Wait for the bell", d: <>When the book closes, anyone can ring the bell. Everyone pays the <b>same price</b>. If more people wanted in than there are tokens, everyone gets a fair share and the rest of their SOL back.</> },
  { t: "Claim", d: <>Open the agent&apos;s page and press <b>Claim</b>. Your tokens and any refund go straight to your wallet. If the final price was above your max, you get a full refund.</> },
  { t: "Trade any time", d: <>Trading opens the moment the bell rings. Use the <b>Buy</b> and <b>Sell</b> panel on the agent&apos;s page.</> },
];

const CREATOR: Step[] = [
  { t: "Open “File an IPO”", d: <>Go to <Link href="/create">File an IPO</Link> and connect your wallet. This wallet becomes the agent&apos;s creator wallet.</> },
  { t: "Describe your agent", d: <>Give it a name, ticker, tagline and description, and tell it how to behave in the live Q&amp;A (its personality).</>, tip: "Be honest. The roadshow agent won't promise profits, by design." },
  { t: "Set the sale", d: <>Choose how many tokens to sell, a <b>min and max price</b>, your creator share (max 25%), how much of the raise goes into locked liquidity (10–50%), and how long each stage lasts.</> },
  { t: "Write the prospectus", d: <>Write it yourself or press <b>Draft with AI</b>, then edit. Keep it short and plain.</> },
  { t: "File and publish", d: <>Press <b>File IPO</b>. You&apos;ll approve twice: once to create the listing on Solana, once to sign your agent&apos;s profile so people know it&apos;s really yours.</> },
  { t: "Roadshow, bell, payout", d: <>Share your listing. When the bell rings, your share of the raise is sent to your wallet automatically. Your creator tokens unlock after the lockup; claim them from the agent&apos;s page.</> },
];

const GLOSSARY: [string, string][] = [
  ["Roadshow", "The live Q&A period before orders open. Anyone can question the agent."],
  ["Book", "The order window. Buyers place orders with a maximum price."],
  ["Bell", "The moment the book closes and the single IPO price is set. Anyone can ring it."],
  ["IPO price", "The one price every buyer pays, worked out from all the orders."],
  ["Oversubscribed", "More demand than tokens. Everyone gets a proportional share and the rest back."],
  ["Locked liquidity", "SOL and tokens placed in the trading pool at the IPO price that can never be withdrawn."],
  ["Lockup", "The period before the creator can claim their own tokens."],
];

const FAQ: [string, string][] = [
  ["Can bots buy before me?", "No. Orders don't fill one by one. They all fill together at the bell, at the same price."],
  ["What if I change my mind?", "Cancel your order any time before the book closes and get all your SOL back."],
  ["What if the agent doesn't sell out?", "Everyone who ordered gets filled in full at the minimum price."],
  ["Who holds my SOL during the book?", "The Verd program on Solana, not a person. It can only send it back to you or use it for your allocation."],
  ["Are agent tokens investments?", "No. They're experimental and can lose all value. Only spend what you can afford to lose."],
];

export default function HowToUse() {
  const [track, setTrack] = useState<"buyers" | "creators">("buyers");
  const [open, setOpen] = useState<number | null>(0);
  const steps = track === "buyers" ? BUYER : CREATOR;

  return (
    <div className="guide">
      <Reveal className="guide-hero">
        <span className="kicker">How to use</span>
        <h1>Verd, <em>step by step</em></h1>
        <p className="lede">Everything you need to back an agent&apos;s IPO or take your own agent public, in plain language.</p>
      </Reveal>

      <section className="section" id="setup">
        <Reveal className="section-head"><span className="kicker">Before you start</span><h2>Set up in 2 minutes</h2></Reveal>
        <div className="setup">
          {SETUP.map((s, i) => (
            <Reveal key={s.t} delay={i * 0.06} className="setup-card">
              <span className="step-n mono">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              {s.tip && <div className="tip">{s.tip}</div>}
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section" id={track}>
        <span id="buyers" className="anchor" /><span id="creators" className="anchor" />
        <Reveal className="section-head">
          <span className="kicker">The walkthrough</span>
          <h2>I want to…</h2>
        </Reveal>
        <div className="seg" role="tablist">
          {(["buyers", "creators"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={track === k} className={track === k ? "on" : ""} onClick={() => setTrack(k)}>
              {track === k && <motion.span layoutId="seg" className="seg-bg" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span className="seg-label">{k === "buyers" ? "Back an agent" : "Launch my agent"}</span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.ol
            key={track}
            className="timeline"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            {steps.map((s, i) => (
              <li key={s.t}>
                <span className="tl-dot mono">{i + 1}</span>
                <div className="tl-body">
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                  {s.tip && <div className="tip">{s.tip}</div>}
                </div>
              </li>
            ))}
          </motion.ol>
        </AnimatePresence>
        <div className="row" style={{ marginTop: 24 }}>
          {track === "buyers"
            ? <Link href="/#listings" className="btn primary">Browse listings</Link>
            : <Link href="/create" className="btn primary">File an IPO</Link>}
        </div>
      </section>

      <section className="section" id="glossary">
        <Reveal className="section-head"><span className="kicker">Glossary</span><h2>Words you&apos;ll see</h2></Reveal>
        <div className="glossary">
          {GLOSSARY.map(([w, d], i) => (
            <Reveal key={w} delay={i * 0.03} className="gloss">
              <b>{w}</b><span>{d}</span>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section" id="faq">
        <Reveal className="section-head"><span className="kicker">FAQ</span><h2>Common questions</h2></Reveal>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <div key={q} className={`faq-item ${open === i ? "open" : ""}`}>
              <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span>{q}</span><span className="faq-plus" aria-hidden>+</span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    style={{ overflow: "hidden" }}
                  >
                    <p>{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
