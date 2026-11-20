"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { useBackend, useConfig, useLaunch, useNow, type PlatformConfig, type Profile } from "@/lib/hooks";
import {
  COMPANY_WALLET, NUM_TICKS, ONE_TOKEN, PHASE_LABEL, api, cancelMessage, countdown, demandCurve, explorerAddress, explorerTx, imageUrl,
  orderMemo, phaseOf, poolPrice, previewClearing, short, sol, tickPrice, tokens, type Launch,
} from "@/lib/stewra";
import { TxNote, confirmSig, useTx } from "@/lib/tx";
import { publishProfile } from "@/lib/publish";
import Prospectus from "@/components/Prospectus";
import AgentAvatar from "@/components/AgentAvatar";
import ImageUpload from "@/components/ImageUpload";
import ReportButton from "@/components/ReportButton";

type OrderRec = { sig: string; lamports: string; maxTick: number; at: number; status: "active" | "cancelled" | "rejected" | "settled"; reason?: string };
type PayoutRec = { id: string; kind: string; lamports: string; tokens: string; status: string; sig?: string };
type Position = { orders: OrderRec[]; tokens: string; refund: string; payouts: PayoutRec[] };
type Entry = { id: string; question: string; answer: string; asker?: string; at: number };

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export default function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { launch, reload } = useLaunch(id);
  const { publicKey } = useWallet();
  const config = useConfig();
  const now = useNow();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [pos, setPos] = useState<Position | null>(null);

  const loadProfile = useCallback(() => {
    fetch(api(`/api/agents/${id}`)).then(async (r) => setProfile(r.ok ? await r.json() : null)).catch(() => setProfile(null));
  }, [id]);
  useEffect(loadProfile, [loadProfile]);

  const loadPos = useCallback(async () => {
    if (!publicKey) return setPos(null);
    const r = await fetch(api(`/api/launches/${id}/position?buyer=${publicKey.toBase58()}`)).catch(() => null);
    if (r?.ok) setPos(await r.json());
  }, [publicKey, id]);
  useEffect(() => {
    loadPos();
    const t = setInterval(loadPos, 5000);
    return () => clearInterval(t);
  }, [loadPos]);

  const refresh = useCallback(async () => { await reload(); await loadPos(); }, [reload, loadPos]);

  if (launch === undefined) return <div className="empty" style={{ marginTop: 40 }}>Loading listing…</div>;
  if (launch === null) return <div className="empty" style={{ marginTop: 40 }}>Listing not found. <Link href="/">Back to listings</Link></div>;

  const phase = phaseOf(launch, now);
  const isCreator = publicKey?.toBase58() === launch.creator;
  const clockTarget = phase === "roadshow" ? launch.roadshowEnd : phase === "book" ? launch.orderEnd : null;
  const hasOrders = Boolean(pos?.orders.length);

  return (
    <>
      {profile?.banner && !profile.hidden && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="lbanner" src={imageUrl(profile.banner)} alt="" />
      )}
      <div className={`lhead ${profile?.banner ? "lhead-overlap" : ""}`}>
        <AgentAvatar logo={profile?.hidden ? undefined : profile?.logo} emoji={profile?.emoji} />
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{launch.name}</h1>
            <span className="muted mono">${launch.symbol}</span>
            <span className={`pill ${phase}`}>{PHASE_LABEL[phase]}</span>
          </div>
          <div className="tag">{profile?.hidden ? "Removed" : profile?.tagline ?? "No profile published yet"}</div>
          <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
            creator {short(launch.creator)}
            {" · "}<a href={explorerAddress(launch.mint)} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>token</a>
            {profile?.website && !profile.hidden && <> · <a href={profile.website} target="_blank" rel="nofollow noopener noreferrer" style={{ textDecoration: "underline" }}>website</a></>}
            {" · "}<ReportButton launch={launch.address} />
          </div>
        </div>
        {clockTarget && (
          <div className="clock">
            <small>{phase === "roadshow" ? "Order book opens in" : "Order book closes in"}</small>
            <b>{countdown(clockTarget, now)}</b>
          </div>
        )}
      </div>

      {profile?.hidden && (
        <div className="note err" style={{ marginBottom: 16 }}>
          This listing was removed by moderators. New orders are refused and refunded. If you already ordered, you can cancel below, or your refund is paid automatically after the bell.
        </div>
      )}
      <div className="grid2">
        <div className="stack">
          {profile === null && isCreator && <ProfileForm launch={launch} onSaved={loadProfile} />}
          {profile && !profile.hidden && (
            <div className="panel">
              <h2>Prospectus</h2>
              <Prospectus text={profile.prospectus} />
              <h4 className="muted" style={{ margin: "16px 0 6px", fontSize: 13 }}>About the agent</h4>
              <p style={{ margin: 0, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{profile.description}</p>
            </div>
          )}
          {!profile?.hidden && <Roadshow launch={launch} profile={profile ?? null} phase={phase} />}
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
          {phase === "book" && <OrderPanel launch={launch} config={config} pos={pos} onChange={refresh} />}
          {phase === "book" && hasOrders && <YourOrders launch={launch} pos={pos!} canCancel onChange={refresh} />}
          {phase === "bell" && <BellPanel launch={launch} hasOrders={hasOrders} />}
          {phase === "settling" && <SettlingPanel launch={launch} />}
          {(phase === "settling" || phase === "trading" || phase === "failed") && (
            <>
              <Results launch={launch} />
              {hasOrders && <AllocationPanel launch={launch} pos={pos!} />}
              {phase === "trading" && <TradePanel launch={launch} />}
            </>
          )}
          {phase === "bell" && hasOrders && <YourOrders launch={launch} pos={pos!} canCancel={false} onChange={refresh} />}
          {isCreator && launch.finalized && launch.creatorSupply > 0 && <CreatorPanel launch={launch} now={now} />}
        </div>
      </div>
    </>
  );
}

// ───────────────────────── roadshow ─────────────────────────

function Roadshow({ launch, profile, phase }: { launch: Launch; profile: Profile | null; phase: string }) {
  const { publicKey } = useWallet();
  const { ai } = useBackend();
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
      {open && profile && ai === false && (
        <div className="note" style={{ marginTop: 12 }}>Live Q&amp;A for this agent isn&apos;t available yet. Read the prospectus above in the meantime.</div>
      )}
      {open && profile && ai !== false && (
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
  const [f, setF] = useState({ tagline: "", description: "", persona: "", prospectus: "", website: "", emoji: "🤖", logo: "", banner: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const search = useSearchParams();
  return (
    <div className="panel stack">
      <h2 style={{ margin: 0 }}>Publish your agent&apos;s profile</h2>
      {search.get("profile") === "missing" && <div className="note">Your IPO is filed. Publish the profile so people can see and question your agent.</div>}
      <div className="ff"><label>Logo</label><ImageUpload kind="logo" value={f.logo} onChange={(id) => setF((c) => ({ ...c, logo: id }))} /></div>
      <div className="ff"><label>Banner <span className="opt">Optional</span></label><ImageUpload kind="banner" value={f.banner} onChange={(id) => setF((c) => ({ ...c, banner: id }))} /></div>
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


// ───────────────────────── sale terms & orders ─────────────────────────

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
        Creator keeps {((launch.creatorSupply / launch.saleSupply) * 100).toFixed(0)}% extra tokens, held by Sipt until{" "}
        {launch.finalized ? new Date(launch.lockUntil * 1000).toLocaleString() : "the lockup ends after the bell"}. Platform fee {launch.feeBps / 100}%, trading fee {launch.swapFeeBps / 100}%.
        Pool liquidity is permanently locked on Meteora at the bell.
      </p>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
        <b>Custodial:</b> orders are paid to the Sipt company wallet{config?.company ? <> (<a href={explorerAddress(config.company)} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{short(config.company)}</a>)</> : null}, which holds them until the bell and sends tokens and refunds. <Link href="/risk" style={{ textDecoration: "underline" }}>Risks</Link>
      </p>
    </div>
  );
}

function OrderPanel({ launch, config, pos, onChange }: { launch: Launch; config: PlatformConfig | null; pos: Position | null; onChange: () => Promise<void> }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const [amount, setAmount] = useState("0.5");
  const [tick, setTick] = useState(NUM_TICKS - 1);
  const [agree, setAgree] = useState(false);

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

  const mismatch = config?.company && config.company !== COMPANY_WALLET;

  async function place() {
    const lamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
    if (!(lamports >= 0.01 * LAMPORTS_PER_SOL)) throw new Error("The minimum order is 0.01 SOL.");
    if (!config?.company) throw new Error("Couldn't reach Sipt. Try again in a moment.");
    if (mismatch) throw new Error("Safety check failed: the server's company wallet doesn't match this site. Don't send funds; contact Sipt.");
    if (config.paused) throw new Error("Sipt is paused. Orders are on hold.");
    const t = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: publicKey!, toPubkey: new PublicKey(COMPANY_WALLET), lamports }),
      new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(orderMemo(launch.address, tick), "utf8") }),
    );
    const sig = await sendTransaction(t, connection);
    await confirmSig(connection, sig);
    // Report it; the server credits it once it's finalized (usually under a minute) and also finds it on its own.
    for (let i = 0; i < 30; i++) {
      const r = await fetch(api("/api/orders"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature: sig }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 200) {
        if (d.status === "order") return sig;
        if (String(d.status).startsWith("rejected")) throw new Error(`Order refused (${String(d.status).slice(10)}). Your SOL will be refunded automatically.`);
        return sig;
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
    return sig; // still finalizing; it will show up under "Your orders"
  }

  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>{pos?.orders.some((o) => o.status === "active") ? "Add another order" : "Place an order"}</h3>
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
      <label className="row" style={{ gap: 8, fontSize: 13, alignItems: "flex-start", flexWrap: "nowrap" }}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
        <span className="muted">I understand my SOL goes to the Sipt company wallet, which holds it until the bell and then sends my tokens and any refund. This is custodial, not a smart contract.</span>
      </label>
      {mismatch && <div className="note err">Safety check failed: the server reports a different company wallet than this site. Orders are disabled.</div>}
      <button className="btn primary" disabled={!publicKey || !agree || Boolean(mismatch) || tx.state.kind === "pending"} onClick={async () => {
        if (await tx.run("Placing order — approve in your wallet, then wait for confirmation", place, "Order placed")) await onChange();
      }}>{publicKey ? "Place order" : "Connect wallet to order"}</button>
      <TxNote state={tx.state} />
    </div>
  );
}

const ORDER_STATUS: Record<string, string> = { active: "Open", cancelled: "Cancelled", rejected: "Refused", settled: "Settled" };

function YourOrders({ launch, pos, canCancel, onChange }: { launch: Launch; pos: Position; canCancel: boolean; onChange: () => Promise<void> }) {
  const { publicKey, signMessage } = useWallet();
  const tx = useTx();
  const open = pos.orders.filter((o) => o.status === "active");
  const refunds = pos.payouts.filter((p) => p.kind === "refund");
  async function cancel() {
    if (!signMessage) throw new Error("Your wallet can't sign messages. Try Phantom, Backpack or Solflare.");
    const ts = Date.now();
    const sig = await signMessage(new TextEncoder().encode(cancelMessage(launch.address, ts)));
    const r = await fetch(api(`/api/launches/${launch.address}/cancel`), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ buyer: publicKey!.toBase58(), ts, signature: bs58.encode(sig) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Couldn't cancel");
  }
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>Your orders</h3>
      <div className="stack" style={{ gap: 6 }}>
        {pos.orders.map((o) => (
          <div key={o.sig} className="row mono" style={{ fontSize: 13 }}>
            <span>{sol(Number(o.lamports))} SOL</span>
            <span className="muted">max {sol(tickPrice(launch, o.maxTick), 6)}</span>
            <span className="spacer" />
            <span className={o.status === "rejected" ? "muted" : ""}>{ORDER_STATUS[o.status]}{o.reason ? ` · ${o.reason}` : ""}</span>
            <a href={explorerTx(o.sig)} target="_blank" rel="noreferrer" className="muted" style={{ textDecoration: "underline" }}>tx</a>
          </div>
        ))}
      </div>
      {refunds.map((p) => (
        <div key={p.id} className="note">
          Refund of {sol(Number(p.lamports))} SOL: {p.status === "done" ? <>sent{p.sig && <> · <a href={explorerTx(p.sig)} target="_blank" rel="noreferrer">view</a></>}</> : "queued, paid from the company wallet shortly"}
        </div>
      ))}
      {canCancel && open.length > 0 && (
        <>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>You can cancel before the book closes. Your SOL is sent back from the company wallet.</p>
          <button className="btn" disabled={tx.state.kind === "pending"} onClick={async () => {
            if (await tx.run("Sign the cancellation in your wallet", cancel, "Cancelled. Your refund is queued.")) await onChange();
          }}>Cancel {open.length > 1 ? `all ${open.length} orders` : "order"}</button>
        </>
      )}
      <TxNote state={tx.state} />
    </div>
  );
}

function BellPanel({ launch, hasOrders }: { launch: Launch; hasOrders: boolean }) {
  const preview = previewClearing(launch);
  return (
    <div className="bell-banner stack">
      <div className="big">🔔</div>
      <h2 style={{ margin: 0 }}>The book is closed</h2>
      <p className="muted" style={{ margin: 0 }}>
        {launch.totalBudget > 0
          ? <>The bell rings automatically within about a minute. Everyone will pay <b className="mono">{sol(preview.price, 6)} SOL</b> per token.</>
          : <>No orders came in. The listing will close without a sale.</>}
      </p>
      {hasOrders && <p style={{ margin: 0 }}>Your tokens and any refund are sent to your wallet automatically after the bell.</p>}
    </div>
  );
}

function SettlingPanel({ launch }: { launch: Launch }) {
  const { total, done } = launch.settle;
  return (
    <div className="panel">
      <h3>Bell rung · settling</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        Sipt is sending tokens and refunds from the company wallet, then opening the locked pool. {total > 0 && <b className="mono">{done}/{total} done</b>}
      </p>
    </div>
  );
}

// ───────────────────────── after the bell ─────────────────────────

function Results({ launch }: { launch: Launch }) {
  if (launch.soldValue === 0) {
    return <div className="panel"><h3>Closed without demand</h3><p className="muted" style={{ margin: 0 }}>No tokens were sold. Every order is refunded in full from the company wallet.</p></div>;
  }
  const over = launch.eligibleBudget / launch.soldValue;
  const now = poolPrice(launch);
  const change = now ? (now / launch.clearingPrice - 1) * 100 : 0;
  return (
    <div className="panel">
      <h3>IPO results</h3>
      <div className="stats">
        <div><small>IPO price</small><b>{sol(launch.clearingPrice, 6)}</b></div>
        <div><small>Raised</small><b>{sol(launch.soldValue, 2)} SOL</b></div>
        <div><small>Demand</small><b>{over.toFixed(2)}×</b></div>
        <div><small>Buyers</small><b>{launch.orderCount}</b></div>
        <div><small>Price now</small><b>{now ? sol(now, 6) : "—"}</b></div>
        <div><small>Since IPO</small><b style={{ color: change >= 0 ? "var(--green)" : "var(--red)" }}>{now ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}</b></div>
        <div><small>Liquidity</small><b>{launch.poolSol ? `${sol(launch.poolSol, 2)} SOL` : "—"}</b></div>
        <div><small>Pool</small><b>{launch.pool ? <a href={explorerAddress(launch.pool)} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Meteora</a> : "opening"}</b></div>
      </div>
    </div>
  );
}

function AllocationPanel({ launch, pos }: { launch: Launch; pos: Position }) {
  const settle = pos.payouts.filter((p) => p.kind === "settle");
  const tok = settle.reduce((s, p) => s + Number(p.tokens), 0);
  const refund = settle.reduce((s, p) => s + Number(p.lamports), 0);
  const sent = settle.length > 0 && settle.every((p) => p.status === "done");
  return (
    <div className="panel stack" style={{ borderColor: "var(--green-dim)" }}>
      <h3 style={{ margin: 0 }}>Your allocation</h3>
      <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div><small>Tokens</small><b>{tokens(tok)} ${launch.symbol}</b></div>
        <div><small>Refund</small><b>{sol(refund)} SOL</b></div>
      </div>
      {tok === 0 && launch.soldValue > 0 && settle.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>The IPO price was above your max price, so you get a full refund.</p>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {settle.length === 0 ? "Nothing to settle for this wallet." : sent ? <>Sent to your wallet{settle[0].sig && <> · <a href={explorerTx(settle[0].sig)} target="_blank" rel="noreferrer">view transaction</a></>}.</> : "Being sent to your wallet automatically. No action needed."}
      </p>
    </div>
  );
}

function TradePanel({ launch }: { launch: Launch }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const tx = useTx();
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState({ sol: 0, tok: 0 });
  const [quote, setQuote] = useState<{ out: string; fee: string; priceImpact: number; tx: string; key: string } | null>(null);
  const [qErr, setQErr] = useState("");

  const loadBal = useCallback(async () => {
    if (!publicKey) return;
    const ata = getAssociatedTokenAddressSync(new PublicKey(launch.mint), publicKey);
    const [s, t] = await Promise.all([
      connection.getBalance(publicKey),
      connection.getTokenAccountBalance(ata).then((r) => Number(r.value.amount)).catch(() => 0),
    ]);
    setBal({ sol: s, tok: t });
  }, [publicKey, connection, launch.mint]);
  useEffect(() => {
    loadBal();
    const t = setInterval(loadBal, 6000);
    return () => clearInterval(t);
  }, [loadBal]);

  const amountIn = Math.floor(Number(amount) * (buy ? LAMPORTS_PER_SOL : ONE_TOKEN));
  const key = `${buy}:${amountIn}:${publicKey?.toBase58()}`;

  // Quote from the server (it builds the pool transaction your wallet will sign).
  useEffect(() => {
    setQuote(null); setQErr("");
    if (!publicKey || !(amountIn > 0)) return;
    const t = setTimeout(async () => {
      const r = await fetch(api("/api/swap"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mint: launch.mint, trader: publicKey.toBase58(), buy, amountIn: String(amountIn), slippageBps: 200 }),
      }).catch(() => null);
      const d = await r?.json().catch(() => ({}));
      if (r?.ok) setQuote({ ...d, key }); else setQErr(d?.error || "Couldn't get a quote");
    }, 400);
    return () => clearTimeout(t);
  }, [key, amountIn, buy, publicKey, launch.mint]);

  return (
    <div className="panel stack">
      <div className="row"><h3 style={{ margin: 0 }}>Trade ${launch.symbol}</h3><span className="spacer" />
        {publicKey && <span className="muted mono" style={{ fontSize: 12 }}>{sol(bal.sol, 3)} SOL · {tokens(bal.tok)} {launch.symbol}</span>}
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
      {quote && quote.key === key && (
        <div className="note">
          You get about <b className="mono">{buy ? `${tokens(Number(quote.out))} ${launch.symbol}` : `${sol(Number(quote.out))} SOL`}</b>
          <span className="muted"> · {launch.swapFeeBps / 100}% pool fee · max 2% slippage{quote.priceImpact > 1 ? ` · ${quote.priceImpact.toFixed(1)}% price impact` : ""}</span>
        </div>
      )}
      {qErr && amountIn > 0 && <div className="note err">{qErr}</div>}
      <button className={`btn ${buy ? "primary" : ""}`} disabled={!publicKey || !quote || quote.key !== key || tx.state.kind === "pending"} onClick={async () => {
        if (await tx.run(buy ? "Buying — approve in your wallet" : "Selling — approve in your wallet", async () => {
          const t = Transaction.from(Buffer.from(quote!.tx, "base64"));
          const sig = await sendTransaction(t, connection);
          await confirmSig(connection, sig);
          return sig;
        }, buy ? "Bought" : "Sold")) { setAmount(""); await loadBal(); }
      }}>{publicKey ? (buy ? "Buy" : "Sell") : "Connect wallet to trade"}</button>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>Trades go straight from your wallet to the listing&apos;s Meteora pool. Sipt never holds your funds when you trade.</p>
      <TxNote state={tx.state} />
    </div>
  );
}

function CreatorPanel({ launch, now }: { launch: Launch; now: number }) {
  const amount = launch.saleSupply ? Math.floor((launch.creatorSupply * launch.tokensSold) / launch.saleSupply) : 0;
  const locked = now < launch.lockUntil;
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>Creator allocation</h3>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {launch.creatorClaimed ? `Sent ${tokens(amount)} ${launch.symbol} to your wallet.`
          : amount === 0 ? "No creator tokens: the sale didn't complete."
          : locked ? <>Your {tokens(amount)} {launch.symbol} are held by Sipt and sent to you automatically in <b className="mono">{countdown(launch.lockUntil, now)}</b>.</>
          : `Your ${tokens(amount)} ${launch.symbol} are unlocked and being sent to your wallet.`}
      </p>
    </div>
  );
}
