"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useConfig } from "@/lib/hooks";
import { CLUSTER, ONE_TOKEN, api, getProgram, imageUrl, launchPda } from "@/lib/stewra";
import { publishProfile } from "@/lib/publish";
import { TxNote, useTx } from "@/lib/tx";
import Prospectus from "@/components/Prospectus";
import ImageUpload from "@/components/ImageUpload";
import AgentAvatar from "@/components/AgentAvatar";

const UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
type Unit = keyof typeof UNITS;

export default function CreatePage() {
  const router = useRouter();
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { signMessage } = useWallet();
  const config = useConfig();
  const tx = useTx();
  const dev = CLUSTER === "localnet"; // short phases only for local testing

  const [f, setF] = useState({
    name: "",
    symbol: "",
    tagline: "",
    description: "",
    persona: "",
    website: "",
    emoji: "🤖",
    logo: "",
    banner: "",
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
    if (!f.logo) return "Upload a logo for your agent.";
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
          new BN(lockSecs),
          api(`/metadata/${launch.toBase58()}.json`)
        )
        .accounts({ creator: wallet!.publicKey } as never)
        .rpc()
    );
    if (!ok) return;
    const ok2 = await tx.run("Filed! Now sign to publish the agent's profile", () =>
      publishProfile(launch.toBase58(), {
        tagline: f.tagline.trim(), description: f.description.trim(), persona: f.persona.trim(),
        prospectus: f.prospectus.trim(), website: f.website.trim(), emoji: f.emoji, logo: f.logo, banner: f.banner,
      }, signMessage).then(() => undefined)
    , "IPO filed");
    // Even if the profile step fails, the launch exists; its page lets the creator retry.
    router.push(`/launch/${launch.toBase58()}${ok2 ? "" : "?profile=missing"}`);
  }

  const [tab, setTab] = useState<"write" | "preview">("write");

  const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fmt = (v: number, max = 4) => v.toLocaleString(undefined, { maximumFractionDigits: max });
  const durLabel = (v: string, u: Unit) => `${fmt(n(v), 1)} ${n(v) === 1 ? u.slice(0, -1) : u}`;

  const feePct = config ? config.feeBps / 100 : 2;
  const lpPct = n(f.lpPct);
  const youPct = Math.max(0, 100 - feePct - lpPct);
  const minRaise = n(f.saleTokens) * n(f.minPrice);
  const maxRaise = n(f.saleTokens) * n(f.maxPrice);
  const creatorTokens = Math.floor((n(f.saleTokens) * n(f.creatorPct)) / 100);

  const checks: [string, boolean][] = [
    ["Wallet connected", !!wallet],
    ["Name and ticker", !!f.name.trim() && /^[A-Za-z0-9]{1,10}$/.test(f.symbol)],
    ["Tagline and description", !!f.tagline.trim() && f.description.trim().length >= 10],
    ["Logo", !!f.logo],
    ["Prospectus", !!f.prospectus.trim()],
  ];
  const ready = checks.every(([, ok]) => ok);

  const duration = (k: "roadshow" | "book" | "lock", label: string, hint: string) => (
    <div className="ff">
      <label htmlFor={`d-${k}`}>{label}</label>
      <div className="ig">
        <input id={`d-${k}`} type="number" min="0" inputMode="decimal" value={f[k]} onChange={set(k)} />
        <select aria-label={`${label} unit`} value={f[`${k}Unit` as "roadshowUnit"]} onChange={set(`${k}Unit` as "roadshowUnit")}>
          {Object.keys(UNITS).map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <span className="ff-hint">{hint}</span>
    </div>
  );

  return (
    <div className="cf">
      <header className="cf-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/#listings">Listings</Link><span aria-hidden>/</span><span>New IPO</span>
        </nav>
        <h1>File an IPO</h1>
        <p>Describe your agent, set the sale terms, and publish. The sale rules are enforced on-chain once filed.</p>
      </header>

      <div className="cf-grid">
        <div className="cf-form">
          <section className="fs">
            <div className="fs-label">
              <h2>Agent</h2>
              <p>How your agent appears in listings and on its IPO page.</p>
            </div>
            <div className="fs-body">
              <div className="ff-row">
                <div className="ff">
                  <label htmlFor="name">Name</label>
                  <input id="name" value={f.name} onChange={set("name")} maxLength={32} placeholder="Oracle Agent" autoComplete="off" />
                </div>
                <div className="ff ff-narrow">
                  <label htmlFor="symbol">Ticker</label>
                  <div className="ig">
                    <span className="ig-affix">$</span>
                    <input id="symbol" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={10} placeholder="ORCL" autoComplete="off" spellCheck={false} />
                  </div>
                </div>
              </div>
              <div className="ff">
                <div className="ff-top"><label htmlFor="tagline">Tagline</label><span className="ff-count">{f.tagline.length}/120</span></div>
                <input id="tagline" value={f.tagline} onChange={set("tagline")} maxLength={120} placeholder="Flags mispriced prediction markets in real time" />
              </div>
              <div className="ff">
                <div className="ff-top"><label htmlFor="desc">Description</label><span className="ff-count">{f.description.length}/2000</span></div>
                <textarea id="desc" value={f.description} onChange={set("description")} maxLength={2000} rows={4}
                  placeholder="What it does, who it's for, and how it earns or plans to earn." />
              </div>
              <div className="ff">
                <label htmlFor="logo-file">Logo</label>
                <ImageUpload id="logo-file" kind="logo" value={f.logo} onChange={(id) => setF((cur) => ({ ...cur, logo: id }))} />
              </div>
              <div className="ff">
                <label htmlFor="banner-file">Banner <span className="opt">Optional</span></label>
                <ImageUpload id="banner-file" kind="banner" value={f.banner} onChange={(id) => setF((cur) => ({ ...cur, banner: id }))} />
              </div>
              <div className="ff">
                <label htmlFor="website">Website <span className="opt">Optional</span></label>
                <input id="website" type="url" value={f.website} onChange={set("website")} placeholder="https://" />
              </div>
            </div>
          </section>

          <section className="fs">
            <div className="fs-label">
              <h2>Roadshow</h2>
              <p>Your agent answers public questions before orders open. It never promises returns.</p>
            </div>
            <div className="fs-body">
              <div className="ff">
                <div className="ff-top"><label htmlFor="persona">Voice and behaviour</label><span className="ff-count">{f.persona.length}/2000</span></div>
                <textarea id="persona" value={f.persona} onChange={set("persona")} maxLength={2000} rows={3}
                  placeholder="Direct and concise. Offers a short worked example when asked how it works." />
              </div>
            </div>
          </section>

          <section className="fs">
            <div className="fs-label">
              <h2>Sale terms</h2>
              <p>Everyone pays one clearing price inside this range. Terms can&apos;t change after filing.</p>
            </div>
            <div className="fs-body">
              <div className="ff-row">
                <div className="ff">
                  <label htmlFor="supply">Tokens for sale</label>
                  <div className="ig"><input id="supply" type="number" min="0" inputMode="numeric" value={f.saleTokens} onChange={set("saleTokens")} /><span className="ig-affix">tokens</span></div>
                </div>
                <div className="ff ff-narrow">
                  <label htmlFor="creator">Creator share</label>
                  <div className="ig"><input id="creator" type="number" min="0" max="25" inputMode="decimal" value={f.creatorPct} onChange={set("creatorPct")} /><span className="ig-affix">%</span></div>
                  <span className="ff-hint">Max 25%, locked</span>
                </div>
              </div>
              <div className="ff">
                <span className="ff-label">Price range per token</span>
                <div className="range-pair">
                  <div className="ig"><span className="ig-affix">Min</span><input aria-label="Minimum price" type="number" step="any" min="0" inputMode="decimal" value={f.minPrice} onChange={set("minPrice")} /><span className="ig-affix">SOL</span></div>
                  <span className="range-sep" aria-hidden>–</span>
                  <div className="ig"><span className="ig-affix">Max</span><input aria-label="Maximum price" type="number" step="any" min="0" inputMode="decimal" value={f.maxPrice} onChange={set("maxPrice")} /><span className="ig-affix">SOL</span></div>
                </div>
              </div>
              <div className="ff">
                <div className="ff-top"><label htmlFor="lp">Locked liquidity</label><span className="ff-value mono">{lpPct}% of raise</span></div>
                <input id="lp" className="slider" type="range" min="10" max="50" step="5" value={f.lpPct} onChange={set("lpPct")} />
                <div className="split" aria-hidden>
                  <span style={{ width: `${feePct}%` }} className="s-fee" />
                  <span style={{ width: `${lpPct}%` }} className="s-lp" />
                  <span style={{ width: `${youPct}%` }} className="s-you" />
                </div>
                <div className="split-legend">
                  <span><i className="s-fee" />Platform {fmt(feePct, 1)}%</span>
                  <span><i className="s-lp" />Liquidity {lpPct}%</span>
                  <span><i className="s-you" />You {fmt(youPct, 1)}%</span>
                </div>
              </div>
            </div>
          </section>

          <section className="fs">
            <div className="fs-label">
              <h2>Schedule</h2>
              <p>The bell can be rung by anyone once the order window closes.</p>
            </div>
            <div className="fs-body">
              <div className="ff-row ff-row-3">
                {duration("roadshow", "Roadshow", "Q&A before orders")}
                {duration("book", "Order window", "Orders and cancels")}
                {duration("lock", "Creator lockup", "Starts at the bell")}
              </div>
            </div>
          </section>

          <section className="fs">
            <div className="fs-label">
              <h2>Prospectus</h2>
              <p>Short and plain. Use <code>## Heading</code> lines and <code>- </code> bullets.</p>
            </div>
            <div className="fs-body">
              <div className="editor">
                <div className="editor-bar">
                  <div className="seg sm" role="tablist">
                    <button role="tab" aria-selected={tab === "write"} className={tab === "write" ? "on" : ""} onClick={() => setTab("write")}><span className="seg-label">Write</span></button>
                    <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}><span className="seg-label">Preview</span></button>
                  </div>
                  <span className="spacer" />
                  <button className="btn sm ghost" type="button" onClick={draft} disabled={drafting}>{drafting ? "Generating…" : "Generate draft"}</button>
                </div>
                {tab === "write" ? (
                  <textarea aria-label="Prospectus" className="editor-area" value={f.prospectus} onChange={set("prospectus")} maxLength={6000} rows={12}
                    placeholder={"## Overview\nOne or two sentences.\n\n## Risks\n- Signals can be wrong"} />
                ) : (
                  <div className="editor-preview">
                    {f.prospectus.trim() ? <Prospectus text={f.prospectus} /> : <p className="muted">Nothing to preview yet.</p>}
                  </div>
                )}
              </div>
              {draftErr && <div className="note err">{draftErr}</div>}
            </div>
          </section>
        </div>

        <aside className="cf-aside">
          <div className="sum">
            {f.banner && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="sum-banner" src={imageUrl(f.banner)} alt="" />
            )}
            <div className="sum-preview">
              <AgentAvatar logo={f.logo} emoji={f.logo ? undefined : "·"} />
              <div style={{ minWidth: 0 }}>
                <div className="sum-name">{f.name.trim() || "Untitled agent"} {f.symbol && <span className="mono muted">${f.symbol}</span>}</div>
                <div className="sum-tag">{f.tagline.trim() || "Your tagline appears here"}</div>
              </div>
            </div>

            <dl className="sum-list">
              <div><dt>For sale</dt><dd className="mono">{fmt(n(f.saleTokens), 0)}</dd></div>
              <div><dt>Price</dt><dd className="mono">{fmt(n(f.minPrice), 6)}–{fmt(n(f.maxPrice), 6)} SOL</dd></div>
              <div><dt>Raise</dt><dd className="mono">{fmt(minRaise, 2)}–{fmt(maxRaise, 2)} SOL</dd></div>
              <div><dt>You receive</dt><dd className="mono">up to {fmt((maxRaise * youPct) / 100, 2)} SOL</dd></div>
              <div><dt>Creator tokens</dt><dd className="mono">{fmt(creatorTokens, 0)}</dd></div>
            </dl>

            <ol className="sum-time">
              <li><span>Roadshow</span><b>{durLabel(f.roadshow, f.roadshowUnit)}</b></li>
              <li><span>Order window</span><b>{durLabel(f.book, f.bookUnit)}</b></li>
              <li><span>Bell and trading</span><b>instant</b></li>
              <li><span>Creator unlock</span><b>+{durLabel(f.lock, f.lockUnit)}</b></li>
            </ol>

            <ul className="sum-checks">
              {checks.map(([label, ok]) => (
                <li key={label} className={ok ? "ok" : ""}><span className="chk" aria-hidden />{label}</li>
              ))}
            </ul>

            <button className="btn primary sum-cta" onClick={submit} disabled={tx.state.kind === "pending"}>
              {tx.state.kind === "pending" ? "Filing…" : ready ? "File IPO" : "Review and file"}
            </button>
            <TxNote state={tx.state} />
            <p className="sum-foot">Two signatures: one to file on-chain, one to publish the profile. Filing costs a small amount of SOL for storage.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
