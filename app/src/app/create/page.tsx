"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConfig } from "@/lib/hooks";
import { CLUSTER, ONE_TOKEN, api, getProgram, launchPda } from "@/lib/stewra";
import { publishProfile } from "@/lib/publish";
import { TxNote, useTx } from "@/lib/tx";
import Prospectus from "@/components/Prospectus";

const UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
type Unit = keyof typeof UNITS;
const EMOJIS = ["🤖", "🧠", "🔮", "🦾", "🛰️", "🐙", "⚡", "🧬", "📈", "🎯"];

export default function CreatePage() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { signMessage } = useWallet();
  const config = useConfig();
  const tx = useTx();
  const dev = CLUSTER !== "mainnet-beta";

  const [f, setF] = useState({
    name: "",
    symbol: "",
    tagline: "",
    description: "",
    persona: "",
    website: "",
    emoji: "🤖",
    saleTokens: "1000000",
    creatorPct: "10",
    minPrice: "0.00001",
    maxPrice: "0.0001",
    lpPct: "30",
    roadshow: dev ? "2" : "24",
    roadshowUnit: (dev ? "minutes" : "hours") as Unit,
    book: dev ? "3" : "24",
    bookUnit: (dev ? "minutes" : "hours") as Unit,
    lock: dev ? "5" : "90",
    lockUnit: (dev ? "minutes" : "days") as Unit,
    prospectus: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState("");

  const lockSecs = Number(f.lock) * UNITS[f.lockUnit];
  const lockDays = lockSecs / 86400;

  async function draft() {
    setDrafting(true);
    setDraftErr("");
    try {
      const res = await fetch(api("/api/prospectus"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.name, symbol: f.symbol, tagline: f.tagline, description: f.description,
          saleTokens: Number(f.saleTokens), creatorPct: Number(f.creatorPct), lpPct: Number(f.lpPct),
          lockDays: Math.round(lockDays * 10) / 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setF((cur) => ({ ...cur, prospectus: data.prospectus }));
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  function validate(): string | null {
    if (!wallet) return "Connect your wallet first.";
    if (!config) return "Stewra isn't set up on this network yet (missing platform config).";
    if (!f.name.trim() || f.name.length > 32) return "Name must be 1–32 characters.";
    if (!/^[A-Za-z0-9]{1,10}$/.test(f.symbol)) return "Ticker must be 1–10 letters or numbers.";
    if (!f.tagline.trim() || f.description.trim().length < 10) return "Add a tagline and a description.";
    if (!(Number(f.saleTokens) > 0)) return "Tokens for sale must be above zero.";
    if (!(Number(f.creatorPct) >= 0 && Number(f.creatorPct) <= 25)) return "Creator share must be between 0% and 25%.";
    if (!(Number(f.minPrice) > 0 && Number(f.maxPrice) >= Number(f.minPrice))) return "Max price must be at least the min price.";
    if (!(Number(f.lpPct) >= 10 && Number(f.lpPct) <= 50)) return "Liquidity share must be 10–50%.";
    if (!(Number(f.book) > 0)) return "Order window must be longer than zero.";
    if (lockSecs < config.minLockSecs) return `Creator lockup must be at least ${Math.ceil(config.minLockSecs / 86400)} days on this network.`;
    if (!f.prospectus.trim()) return "Write or draft a prospectus.";
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) { tx.reset(); await tx.run("", async () => { throw new Error(problem); }); return; }
    const program = getProgram(connection, wallet!);
    const launchId = new BN(Date.now());
    const launch = launchPda(wallet!.publicKey, launchId);
    const saleBase = Math.round(Number(f.saleTokens) * ONE_TOKEN);
    const creatorBase = Math.floor((saleBase * Number(f.creatorPct)) / 100);

    const ok = await tx.run("Filing on-chain — approve in your wallet", () =>
      program.methods
        .createLaunch(
          launchId, f.name.trim(), f.symbol.toUpperCase(),
          new BN(saleBase), new BN(creatorBase),
          new BN(Math.round(Number(f.minPrice) * LAMPORTS_PER_SOL)),
          new BN(Math.round(Number(f.maxPrice) * LAMPORTS_PER_SOL)),
          Math.round(Number(f.lpPct) * 100),
          new BN(Math.round(Number(f.roadshow) * UNITS[f.roadshowUnit])),
          new BN(Math.round(Number(f.book) * UNITS[f.bookUnit])),
          new BN(lockSecs)
        )
        .accounts({ creator: wallet!.publicKey } as never)
        .rpc()
    );
    if (!ok) return;
    const ok2 = await tx.run("Filed! Now sign to publish the agent's profile", () =>
      publishProfile(launch.toBase58(), {
        tagline: f.tagline.trim(), description: f.description.trim(), persona: f.persona.trim(),
        prospectus: f.prospectus.trim(), website: f.website.trim(), emoji: f.emoji,
      }, signMessage).then(() => undefined)
    , "IPO filed");
    // Even if the profile step fails, the launch exists; its page lets the creator retry.
    router.push(`/launch/${launch.toBase58()}${ok2 ? "" : "?profile=missing"}`);
  }

  const dur = (k: "roadshow" | "book" | "lock", label: string, hint: string) => (
    <div className="field">
      <label>{label}</label>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input type="number" min="0" value={f[k]} onChange={set(k)} />
        <select value={f[`${k}Unit` as "roadshowUnit"]} onChange={set(`${k}Unit` as "roadshowUnit")} style={{ maxWidth: 120 }}>
          {Object.keys(UNITS).map((u) => <option key={u}>{u}</option>)}
        </select>
      </div>
      <span className="hint">{hint}</span>
    </div>
  );

  return (
    <div className="stack" style={{ padding: "28px 0" }}>
      <div>
        <h1 style={{ margin: "0 0 6px", letterSpacing: "-.8px" }}>File your agent&apos;s IPO</h1>
        <p className="muted" style={{ margin: 0 }}>Takes a few minutes. Everything about the sale is enforced by the Stewra program on Solana.</p>
      </div>

      <div className="grid2">
        <div className="stack">
          <div className="panel form-grid">
            <h2 className="full">The agent</h2>
            <div className="field"><label>Name</label><input value={f.name} onChange={set("name")} maxLength={32} placeholder="Oracle Agent" /></div>
            <div className="field"><label>Ticker</label><input value={f.symbol} onChange={set("symbol")} maxLength={10} placeholder="ORCL" /></div>
            <div className="field full"><label>Tagline</label><input value={f.tagline} onChange={set("tagline")} maxLength={120} placeholder="Finds mispriced prediction markets before anyone else" /></div>
            <div className="field full">
              <label>What does it do?</label>
              <textarea value={f.description} onChange={set("description")} maxLength={2000} placeholder="What the agent does, who it's for, and how it makes or could make money." />
            </div>
            <div className="field full">
              <label>Personality for the live Q&amp;A</label>
              <textarea value={f.persona} onChange={set("persona")} maxLength={2000} placeholder="How should your agent talk and answer questions in its roadshow? e.g. Confident, concise, likes showing quick demos." />
              <span className="hint">The roadshow agent follows this, plus Stewra&apos;s honesty rules (no promises of profit).</span>
            </div>
            <div className="field"><label>Website (optional)</label><input value={f.website} onChange={set("website")} placeholder="https://" /></div>
            <div className="field">
              <label>Icon</label>
              <div className="row" style={{ gap: 6 }}>
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className="btn sm" onClick={() => setF({ ...f, emoji: e })}
                    style={{ borderColor: f.emoji === e ? "var(--green)" : undefined, padding: "0 8px" }}>{e}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="panel form-grid">
            <h2 className="full">The sale</h2>
            <div className="field"><label>Tokens for sale</label><input type="number" value={f.saleTokens} onChange={set("saleTokens")} /></div>
            <div className="field">
              <label>Creator share (% of sale, max 25)</label><input type="number" value={f.creatorPct} onChange={set("creatorPct")} />
            </div>
            <div className="field"><label>Min price (SOL per token)</label><input type="number" step="any" value={f.minPrice} onChange={set("minPrice")} /></div>
            <div className="field"><label>Max price (SOL per token)</label><input type="number" step="any" value={f.maxPrice} onChange={set("maxPrice")} /></div>
            <div className="field full">
              <label>Share of money raised locked as trading liquidity (10–50%)</label>
              <input type="number" value={f.lpPct} onChange={set("lpPct")} />
              <span className="hint">
                Platform fee {config ? config.feeBps / 100 : "…"}% · liquidity {f.lpPct}% · you receive {config ? (100 - config.feeBps / 100 - Number(f.lpPct)).toFixed(1) : "…"}% of the raise.
                Liquidity can never be withdrawn.
              </span>
            </div>
            <div className="full form-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {dur("roadshow", "Roadshow", "Live Q&A before orders open")}
              {dur("book", "Order window", "Book-building period")}
              {dur("lock", "Creator lockup", "Your tokens unlock after this")}
            </div>
          </div>
        </div>

        <div className="stack" style={{ position: "sticky", top: 80 }}>
          <div className="panel">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Prospectus</h2>
              <span className="spacer" />
              <button className="btn sm" onClick={draft} disabled={drafting}>{drafting ? "Drafting…" : "✨ Draft with AI"}</button>
            </div>
            {draftErr && <div className="note err" style={{ marginBottom: 10 }}>{draftErr}</div>}
            <div className="field">
              <textarea value={f.prospectus} onChange={set("prospectus")} style={{ minHeight: 220 }} maxLength={6000}
                placeholder={"## Overview\n...\n## Risks\n- ..."} />
            </div>
            {f.prospectus && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted" style={{ cursor: "pointer" }}>Preview</summary>
                <Prospectus text={f.prospectus} />
              </details>
            )}
          </div>
          <div className="panel stack">
            <button className="btn primary" onClick={submit} disabled={tx.state.kind === "pending"}>File IPO</button>
            <TxNote state={tx.state} />
            <span className="muted" style={{ fontSize: 12 }}>
              Filing costs a small amount of SOL for on-chain storage. You&apos;ll sign twice: once to file, once to publish the profile.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
