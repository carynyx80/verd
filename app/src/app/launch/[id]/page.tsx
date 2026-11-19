"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useConfig, useLaunch, useNow, type PlatformConfig, type Profile } from "@/lib/hooks";
import {
  NUM_TICKS, ONE_TOKEN, PHASE_LABEL, api, allocationFor, countdown, demandCurve, getProgram, orderPda, phaseOf,
  poolPrice, previewClearing, quoteSwap, short, sol, tickPrice, tokens, type Launch,
} from "@/lib/verd";
import { TxNote, useTx } from "@/lib/tx";
import { publishProfile } from "@/lib/publish";
import Prospectus from "@/components/Prospectus";

type Order = { budget: number; maxTick: number; placedAt: number };
type Entry = { id: string; question: string; answer: string; asker?: string; at: number };

export default function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { launch, reload } = useLaunch(id);
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const config = useConfig();
  const now = useNow();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [order, setOrder] = useState<Order | null>(null);

  const loadProfile = useCallback(() => {
    fetch(api(`/api/agents/${id}`)).then(async (r) => setProfile(r.ok ? await r.json() : null)).catch(() => setProfile(null));
  }, [id]);
  useEffect(loadProfile, [loadProfile]);

  const loadOrder = useCallback(async () => {
    if (!wallet || !launch) return setOrder(null);
    const o = await getProgram(connection).account.order.fetchNullable(orderPda(new PublicKey(launch.address), wallet.publicKey));
    setOrder(o ? { budget: Number(o.budget.toString()), maxTick: o.maxTick, placedAt: Number(o.placedAt.toString()) } : null);
  }, [wallet, launch, connection]);
  useEffect(() => { loadOrder(); }, [loadOrder]);

  const refresh = useCallback(async () => { await reload(); await loadOrder(); }, [reload, loadOrder]);

  if (launch === undefined) return <div className="empty" style={{ marginTop: 40 }}>Loading listing…</div>;
  if (launch === null) return <div className="empty" style={{ marginTop: 40 }}>Listing not found. <Link href="/">Back to listings</Link></div>;

  const phase = phaseOf(launch, now);
  const isCreator = wallet?.publicKey.toBase58() === launch.creator;
  const clockTarget = phase === "roadshow" ? launch.roadshowEnd : phase === "book" ? launch.orderEnd : null;

  return (
    <>
      <div className="lhead">
        <div className="avatar">{profile?.emoji ?? "🤖"}</div>
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{launch.name}</h1>
            <span className="muted mono">${launch.symbol}</span>
            <span className={`pill ${phase}`}>{PHASE_LABEL[phase]}</span>
          </div>
          <div className="tag">{profile?.tagline ?? "No profile published yet"}</div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
            creator {short(launch.creator)}
            {profile?.website && <> · <a href={profile.website} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>website</a></>}
          </div>
        </div>
        {clockTarget && (
          <div className="clock">
            <small>{phase === "roadshow" ? "Order book opens in" : "Order book closes in"}</small>
            <b>{countdown(clockTarget, now)}</b>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="stack">
          {profile === null && isCreator && <ProfileForm launch={launch} onSaved={loadProfile} />}
          {profile && (
            <div className="panel">
              <h2>Prospectus</h2>
              <Prospectus text={profile.prospectus} />
              <h4 className="muted" style={{ margin: "16px 0 6px", fontSize: 13 }}>About the agent</h4>
              <p style={{ margin: 0, color: "#c9d3cd", whiteSpace: "pre-wrap" }}>{profile.description}</p>
            </div>
          )}
          <Roadshow launch={launch} profile={profile ?? null} phase={phase} />
        </div>

        <div className="stack">
          <SaleTerms launch={launch} config={config} />
          {phase === "roadshow" && (
            <div className="panel">
              <h2>Roadshow in progress</h2>
              <p className="muted" style={{ margin: 0 }}>
                Ask the agent anything. Orders open in <b className="mono">{countdown(launch.roadshowEnd, now)}</b>.
              </p>
            </div>
          )}
          {(phase === "book" || phase === "bell") && <BookChart launch={launch} />}
          {phase === "book" && <OrderPanel launch={launch} order={order} onChange={refresh} />}
          {phase === "bell" && <BellPanel launch={launch} config={config} order={order} onChange={refresh} />}
          {(phase === "trading" || phase === "failed") && (
            <>
              <Results launch={launch} />
              {order && <ClaimPanel launch={launch} order={order} onChange={refresh} />}
              {phase === "trading" && config && <TradePanel launch={launch} config={config} onChange={refresh} />}
            </>
          )}
          {isCreator && launch.finalized && <CreatorPanel launch={launch} now={now} onChange={refresh} />}
        </div>
      </div>
    </>
  );
}

// ───────────────────────── roadshow ─────────────────────────

function Roadshow({ launch, profile, phase }: { launch: Launch; profile: Profile | null; phase: string }) {
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = !launch.finalized;

  useEffect(() => {
    const load = () => fetch(api(`/api/roadshow/${launch.address}`)).then((r) => r.json()).then(setEntries).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [launch.address]);

  async function ask() {
    if (q.trim().length < 3) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch(api(`/api/roadshow/${launch.address}`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q.trim(), asker: publicKey?.toBase58() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEntries((e) => [...e, data]);
      setQ("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Live roadshow</h2>
        <span className="muted" style={{ fontSize: 13 }}>{entries.length} questions answered</span>
      </div>
      <div className="chat">
        {entries.length === 0 && (
          <div className="muted" style={{ fontSize: 14 }}>
            {profile ? "No questions yet. Test this agent — ask what it can do, or ask for a quick demo." : "The roadshow starts once the creator publishes the agent's profile."}
          </div>
        )}
        {entries.map((e) => (
          <div className="qa" key={e.id}>
            <div className="who" style={{ justifySelf: "end" }}>{e.asker ? short(e.asker) : "anon"}</div>
            <div className="q">{e.question}</div>
            <div className="who">{launch.name}</div>
            <div className="a">{e.answer}</div>
          </div>
        ))}
      </div>
      {open && profile && (
        <>
          <div className="ask">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={`Ask ${launch.name} anything…`}
              onKeyDown={(e) => e.key === "Enter" && !busy && ask()} />
            <button className="btn primary" onClick={ask} disabled={busy || q.trim().length < 3}>{busy ? "Thinking…" : "Ask"}</button>
          </div>
          {err && <div className="note err" style={{ marginTop: 8 }}>{err}</div>}
        </>
      )}
      {!open && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>Roadshow closed — transcript kept for the record ({phase}).</div>}
    </div>
  );
}

function ProfileForm({ launch, onSaved }: { launch: Launch; onSaved: () => void }) {
  const { signMessage } = useWallet();
  const tx = useTx();
  const [f, setF] = useState({ tagline: "", description: "", persona: "", prospectus: "", website: "", emoji: "🤖" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const search = useSearchParams();
  return (
    <div className="panel stack">
      <h2 style={{ margin: 0 }}>Publish your agent&apos;s profile</h2>
      {search.get("profile") === "missing" && <div className="note">Your IPO is filed on-chain. Publish the profile so people can see and question your agent.</div>}
      <div className="field"><label>Tagline</label><input value={f.tagline} onChange={set("tagline")} maxLength={120} /></div>
      <div className="field"><label>What does it do?</label><textarea value={f.description} onChange={set("description")} maxLength={2000} /></div>
      <div className="field"><label>Personality for the live Q&amp;A</label><textarea value={f.persona} onChange={set("persona")} maxLength={2000} /></div>
      <div className="field"><label>Prospectus</label><textarea value={f.prospectus} onChange={set("prospectus")} maxLength={6000} /></div>
      <button className="btn primary" disabled={tx.state.kind === "pending"} onClick={async () => {
        if (await tx.run("Sign the message in your wallet", () => publishProfile(launch.address, f, signMessage).then(() => undefined), "Profile published")) onSaved();
      }}>Sign &amp; publish</button>
      <TxNote state={tx.state} />
    </div>
  );
}

// ───────────────────────── sale terms & book ─────────────────────────

function SaleTerms({ launch, config }: { launch: Launch; config: PlatformConfig | null }) {
  const lockDays = launch.lockSecs / 86400;
  return (
    <div className="panel">
      <h3>Sale terms</h3>
      <div className="stats">
        <div><small>For sale</small><b>{tokens(launch.saleSupply, 0)}</b></div>
        <div><small>Price range (SOL)</small><b>{sol(launch.minPrice, 6)}–{sol(launch.maxPrice, 6)}</b></div>
        <div><small>Creator lockup</small><b>{lockDays >= 1 ? `${lockDays.toFixed(0)}d` : `${Math.round(launch.lockSecs / 60)}m`}</b></div>
        <div><small>To liquidity</small><b>{launch.lpBps / 100}%</b></div>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
        Creator keeps {((launch.creatorSupply / launch.saleSupply) * 100).toFixed(0)}% extra tokens, locked until{" "}
        {launch.finalized ? new Date(launch.lockUntil * 1000).toLocaleString() : "the lockup ends after the bell"}. Platform fee {launch.feeBps / 100}%
        {config ? `, trading fee ${config.swapFeeBps / 100}%` : ""}. Liquidity is locked forever.
      </p>
    </div>
  );
}

function BookChart({ launch }: { launch: Launch }) {
  const curve = demandCurve(launch);
  const preview = previewClearing(launch);
  const maxDemand = Math.max(launch.saleSupply * 1.25, ...curve.map((c) => c.demand));
  const supplyPos = (launch.saleSupply / maxDemand) * 100;
  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Order book</h3>
        <span className="spacer" />
        <span className="muted mono" style={{ fontSize: 12 }}>{launch.orderCount} orders · {sol(launch.totalBudget, 2)} SOL</span>
      </div>
      <div className="bars">
        {curve.slice().reverse().map((c) => (
          <div key={c.tick} className={`bar ${launch.totalBudget > 0 && c.tick === preview.tick ? "clear" : ""}`}>
            <span>{sol(c.price, 6)}</span>
            <span className="track">
              <span className="fill" style={{ width: `${Math.min(100, (c.demand / maxDemand) * 100)}%` }} />
              <span className="supply" style={{ left: `${supplyPos}%` }} />
            </span>
            <span style={{ textAlign: "right" }}>{c.demand >= launch.saleSupply ? `${(c.demand / launch.saleSupply).toFixed(2)}×` : `${((c.demand / launch.saleSupply) * 100).toFixed(0)}%`}</span>
          </div>
        ))}
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--green-dim)" }} />demand at that price</span>
        <span><i style={{ background: "var(--amber)" }} />tokens for sale</span>
        <span><i style={{ background: "var(--green)" }} />price if the bell rang now</span>
      </div>
      {launch.totalBudget > 0 && (
        <div className="note" style={{ marginTop: 12 }}>
          If the bell rang now: everyone pays <b className="mono">{sol(preview.price, 6)} SOL</b> per token
          {preview.filled ? `, ${preview.oversubscription.toFixed(2)}× oversubscribed` : `, ${(preview.oversubscription * 100).toFixed(0)}% of tokens sold`}.
        </div>
      )}
    </div>
  );
}

function OrderPanel({ launch, order, onChange }: { launch: Launch; order: Order | null; onChange: () => Promise<void> }) {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const [amount, setAmount] = useState("0.5");
  const [tick, setTick] = useState(NUM_TICKS - 1);

  const est = useMemo(() => {
    const lamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
    if (!(lamports > 0)) return null;
    const buckets = launch.buckets.slice();
    buckets[tick] += lamports;
    const sim = { ...launch, buckets, totalBudget: launch.totalBudget + lamports };
    const p = previewClearing(sim);
    if (tick < p.tick) return { price: p.price, tokens: 0 };
    const eligible = sim.buckets.slice(p.tick).reduce((a, b) => a + b, 0);
    const soldValue = p.filled ? (launch.saleSupply * p.price) / ONE_TOKEN : eligible;
    const spent = (lamports * soldValue) / eligible;
    return { price: p.price, tokens: (spent * ONE_TOKEN) / p.price };
  }, [amount, tick, launch]);

  const program = wallet ? getProgram(connection, wallet) : null;

  if (order) {
    return (
      <div className="panel stack">
        <h3 style={{ margin: 0 }}>Your order</h3>
        <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div><small>Amount</small><b>{sol(order.budget)} SOL</b></div>
          <div><small>Max price</small><b>{sol(tickPrice(launch, order.maxTick), 6)}</b></div>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Your SOL is held by the Verd program until the bell. Anything not used is refunded. You can cancel any time before the book closes.
        </p>
        <button className="btn" disabled={tx.state.kind === "pending"} onClick={async () => {
          if (await tx.run("Cancelling", () => program!.methods.cancelOrder().accounts({ launch: new PublicKey(launch.address), buyer: wallet!.publicKey } as never).rpc(), "Order cancelled, SOL refunded")) await onChange();
        }}>Cancel order</button>
        <TxNote state={tx.state} />
      </div>
    );
  }

  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>Place an order</h3>
      <div className="field">
        <label>Amount (SOL)</label>
        <input type="number" step="any" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label>Most you&apos;ll pay per token</label>
        <select value={tick} onChange={(e) => setTick(Number(e.target.value))}>
          {Array.from({ length: NUM_TICKS }, (_, i) => NUM_TICKS - 1 - i).map((t) => (
            <option key={t} value={t}>{sol(tickPrice(launch, t), 6)} SOL{t === NUM_TICKS - 1 ? " (top of range)" : ""}</option>
          ))}
        </select>
        <span className="hint">If the final price is above this, your order is skipped and fully refunded.</span>
      </div>
      {est && (
        <div className="note">
          {est.tokens > 0
            ? <>Estimate if the bell rang now: about <b className="mono">{tokens(est.tokens)}</b> ${launch.symbol} at <b className="mono">{sol(est.price, 6)}</b> SOL each.</>
            : <>At current demand the price would be {sol(est.price, 6)} SOL, above your max, so this order would be refunded.</>}
        </div>
      )}
      <button className="btn primary" disabled={!wallet || tx.state.kind === "pending"} onClick={async () => {
        const lamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
        if (await tx.run("Placing order — approve in your wallet", () =>
          program!.methods.placeOrder(new BN(lamports), tick).accounts({ launch: new PublicKey(launch.address), buyer: wallet!.publicKey } as never).rpc(),
          "Order placed")) await onChange();
      }}>{wallet ? "Place order" : "Connect wallet to order"}</button>
      <TxNote state={tx.state} />
    </div>
  );
}

function BellPanel({ launch, config, order, onChange }: { launch: Launch; config: PlatformConfig | null; order: Order | null; onChange: () => Promise<void> }) {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const preview = previewClearing(launch);
  return (
    <div className="bell-banner stack">
      <div className="big">🔔</div>
      <h2 style={{ margin: 0 }}>The book is closed</h2>
      <p className="muted" style={{ margin: 0 }}>
        {launch.totalBudget > 0
          ? <>Anyone can ring the bell. Everyone will pay <b className="mono">{sol(preview.price, 6)} SOL</b> per token and trading opens instantly.</>
          : <>No orders came in. Ringing the bell closes the listing.</>}
      </p>
      {order && <p style={{ margin: 0 }}>You have an order of {sol(order.budget)} SOL in this IPO.</p>}
      <button className="btn bell" disabled={!wallet || !config || tx.state.kind === "pending"} onClick={async () => {
        const program = getProgram(connection, wallet!);
        if (await tx.run("Ringing the bell", () =>
          program.methods.finalize().accounts({
            launch: new PublicKey(launch.address), creator: new PublicKey(launch.creator),
            treasury: new PublicKey(config!.treasury), caller: wallet!.publicKey,
          } as never).rpc(), "Bell rung — trading is live")) await onChange();
      }}>{wallet ? "Ring the bell" : "Connect wallet to ring the bell"}</button>
      <TxNote state={tx.state} />
    </div>
  );
}

// ───────────────────────── after the bell ─────────────────────────

function Results({ launch }: { launch: Launch }) {
  if (launch.soldValue === 0) {
    return <div className="panel"><h3>Closed without demand</h3><p className="muted" style={{ margin: 0 }}>No tokens were sold. Anyone with an order can reclaim their SOL below.</p></div>;
  }
  const over = launch.eligibleBudget / launch.soldValue;
  const change = (poolPrice(launch) / launch.clearingPrice - 1) * 100;
  return (
    <div className="panel">
      <h3>IPO results</h3>
      <div className="stats">
        <div><small>IPO price</small><b>{sol(launch.clearingPrice, 6)}</b></div>
        <div><small>Raised</small><b>{sol(launch.soldValue, 2)} SOL</b></div>
        <div><small>Demand</small><b>{over.toFixed(2)}×</b></div>
        <div><small>Buyers</small><b>{launch.orderCount}</b></div>
        <div><small>Price now</small><b>{sol(poolPrice(launch), 6)}</b></div>
        <div><small>Since IPO</small><b style={{ color: change >= 0 ? "var(--green)" : "var(--red)" }}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</b></div>
        <div><small>Liquidity</small><b>{sol(launch.poolSol, 2)} SOL</b></div>
        <div><small>Volume</small><b>{sol(launch.volumeSol, 2)} SOL</b></div>
      </div>
    </div>
  );
}

function ClaimPanel({ launch, order, onChange }: { launch: Launch; order: Order; onChange: () => Promise<void> }) {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const a = allocationFor(launch, order.budget, order.maxTick);
  const refund = order.budget - a.spent;
  return (
    <div className="panel stack" style={{ borderColor: "var(--green-dim)" }}>
      <h3 style={{ margin: 0 }}>Your allocation</h3>
      <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div><small>Tokens</small><b>{tokens(a.tokens)} ${launch.symbol}</b></div>
        <div><small>Refund</small><b>{sol(refund)} SOL</b></div>
      </div>
      {a.tokens === 0 && launch.soldValue > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>The IPO price was above your max price, so you get a full refund.</p>}
      <button className="btn primary" disabled={tx.state.kind === "pending"} onClick={async () => {
        const program = getProgram(connection, wallet!);
        if (await tx.run("Claiming", () => program.methods.claim().accounts({ launch: new PublicKey(launch.address), buyer: wallet!.publicKey } as never).rpc(), "Claimed")) await onChange();
      }}>Claim {a.tokens > 0 ? "tokens" : ""}{a.tokens > 0 && refund > 0 ? " + " : ""}{refund > 0 ? "refund" : ""}</button>
      <TxNote state={tx.state} />
    </div>
  );
}

function TradePanel({ launch, config, onChange }: { launch: Launch; config: PlatformConfig; onChange: () => Promise<void> }) {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState({ sol: 0, tok: 0 });

  const loadBal = useCallback(async () => {
    if (!wallet) return;
    const ata = getAssociatedTokenAddressSync(new PublicKey(launch.mint), wallet.publicKey);
    const [s, t] = await Promise.all([
      connection.getBalance(wallet.publicKey),
      connection.getTokenAccountBalance(ata).then((r) => Number(r.value.amount)).catch(() => 0),
    ]);
    setBal({ sol: s, tok: t });
  }, [wallet, connection, launch.mint]);
  useEffect(() => {
    loadBal();
    const t = setInterval(loadBal, 4000); // picks up claims made in other panels
    return () => clearInterval(t);
  }, [loadBal, launch.poolSol]);

  const amountIn = Math.floor(Number(amount) * (buy ? LAMPORTS_PER_SOL : ONE_TOKEN));
  const out = quoteSwap(launch, amountIn, buy, config.swapFeeBps);
  const minOut = Math.floor(out * 0.98);

  return (
    <div className="panel stack">
      <div className="row"><h3 style={{ margin: 0 }}>Trade ${launch.symbol}</h3><span className="spacer" />
        {wallet && <span className="muted mono" style={{ fontSize: 12 }}>{sol(bal.sol, 3)} SOL · {tokens(bal.tok)} {launch.symbol}</span>}
      </div>
      <div className="tabs">
        <button className={buy ? "on buy" : ""} onClick={() => setBuy(true)}>Buy</button>
        <button className={!buy ? "on sell" : ""} onClick={() => setBuy(false)}>Sell</button>
      </div>
      <div className="field">
        <label>{buy ? "You pay (SOL)" : `You sell (${launch.symbol})`}</label>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
          {!buy && <button className="btn sm" onClick={() => setAmount(String(bal.tok / ONE_TOKEN))}>Max</button>}
        </div>
      </div>
      {amountIn > 0 && (
        <div className="note">
          You get about <b className="mono">{buy ? `${tokens(out)} ${launch.symbol}` : `${sol(out)} SOL`}</b>
          <span className="muted"> · {config.swapFeeBps / 100}% fee · max 2% slippage</span>
        </div>
      )}
      <button className={`btn ${buy ? "primary" : ""}`} disabled={!wallet || !(amountIn > 0) || !(out > 0) || tx.state.kind === "pending"} onClick={async () => {
        const program = getProgram(connection, wallet!);
        if (await tx.run(buy ? "Buying" : "Selling", () =>
          program.methods.swap(new BN(amountIn), new BN(minOut), buy).accounts({
            launch: new PublicKey(launch.address), treasury: new PublicKey(config.treasury), trader: wallet!.publicKey,
          } as never).rpc(), buy ? "Bought" : "Sold")) { setAmount(""); await onChange(); await loadBal(); }
      }}>{wallet ? (buy ? "Buy" : "Sell") : "Connect wallet to trade"}</button>
      <TxNote state={tx.state} />
    </div>
  );
}

function CreatorPanel({ launch, now, onChange }: { launch: Launch; now: number; onChange: () => Promise<void> }) {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const amount = launch.saleSupply ? Math.floor((launch.creatorSupply * launch.tokensSold) / launch.saleSupply) : 0;
  const locked = now < launch.lockUntil;
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>Creator allocation</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {launch.creatorClaimed ? `Claimed ${tokens(amount)} ${launch.symbol}.`
          : locked ? <>Your {tokens(amount)} {launch.symbol} unlock in <b className="mono">{countdown(launch.lockUntil, now)}</b>.</>
          : `${tokens(amount)} ${launch.symbol} are unlocked.`}
      </p>
      {!launch.creatorClaimed && amount > 0 && (
        <button className="btn" disabled={locked || tx.state.kind === "pending"} onClick={async () => {
          const program = getProgram(connection, wallet!);
          if (await tx.run("Claiming", () => program.methods.claimCreator().accounts({ launch: new PublicKey(launch.address), creator: wallet!.publicKey } as never).rpc(), "Creator tokens claimed")) await onChange();
        }}>{locked ? "Locked" : "Claim creator tokens"}</button>
      )}
      <TxNote state={tx.state} />
    </div>
  );
}
