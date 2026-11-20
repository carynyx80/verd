"use client";
import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { api, explorerTx, short, sol, tokens } from "@/lib/stewra";

type Item = { id: string; kind: string; launch: string; symbol?: string; to: string; lamports: string; tokens: string; status: string; ready: boolean; notBefore?: number; sig?: string; awaiting: boolean; error?: string; attempts: number };
type Data = {
  pending: Item[]; recent: Item[];
  unattributed: { sig: string; from: string; lamports: string; memo: string; at: number; note: string }[];
  solvency: { balance: string; owed: string; openOrders: string; pendingPayouts: string; surplus: string };
  platform: { network: string; company: string | null; paused: boolean; payoutMode: string };
};

const KIND: Record<string, string> = {
  refund: "Refund", settle: "Tokens + refund", fee: "Platform fee", "creator-sol": "Creator proceeds", "creator-tokens": "Mint creator tokens (held)",
  "lp-mint": "Mint pool tokens", pool: "Create locked pool", revoke: "Revoke mint authority", "creator-release": "Release creator tokens",
};

type Signed = (action: string, launch?: string) => Promise<{ wallet: string; signature: string; ts: number; action: string; launch: string }>;

/**
 * Company-wallet payouts. The server builds each transaction; the company wallet signs them here in the
 * browser; the server checks they match exactly and broadcasts them once. No private key lives on the server.
 */
export default function PayoutsAdmin({ signed }: { signed: Signed }) {
  const { publicKey, signAllTransactions } = useWallet();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function post(path: string, action: string, extra: object = {}) {
    const res = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(await signed(action)), ...extra }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d;
  }
  async function run(label: string, fn: () => Promise<void>) {
    setErr(""); setMsg(""); setBusy(label);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  const load = () => run("load", async () => setData(await post("/api/admin/payouts", "payouts")));

  const signAndSend = () => run("sign", async () => {
    if (!data?.platform.company || publicKey?.toBase58() !== data.platform.company) throw new Error(`Connect the company wallet (${data?.platform.company ? short(data.platform.company) : "not configured"}) to sign payouts.`);
    if (!signAllTransactions) throw new Error("This wallet can't sign multiple transactions.");
    const { items } = await post("/api/admin/payouts/build", "sign-payouts");
    if (!items.length) { setMsg("Nothing ready to sign right now."); await load(); return; }
    const txs = items.map((i: { tx: string }) => Transaction.from(Buffer.from(i.tx, "base64")));
    const signedTxs = await signAllTransactions(txs);
    const res = await fetch(api("/api/admin/payouts/submit"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: items.map((i: { id: string }, k: number) => ({ id: i.id, tx: signedTxs[k].serialize().toString("base64") })) }),
    });
    const { results } = await res.json();
    const ok = results.filter((r: { ok: boolean }) => r.ok).length;
    const bad = results.filter((r: { ok: boolean }) => !r.ok).map((r: { error: string }) => r.error);
    setMsg(`Sent ${ok} of ${results.length}. Confirmations show up in a few seconds.`);
    if (bad.length) setErr(bad.join(" · "));
    setTimeout(load, 4000);
  });

  const pause = (on: boolean) => run(on ? "pause" : "unpause", async () => {
    if (on && !confirm("Pause Sipt? New filings and orders are refused (and refunded later), the bell waits, and all payouts stop.")) return;
    await post(on ? "/api/admin/pause" : "/api/admin/unpause", on ? "pause" : "unpause");
    await load();
  });

  if (!data) {
    return (
      <section>
        <h2>Company wallet</h2>
        <button className="btn" onClick={load} disabled={!!busy}>{busy ? "Waiting for signature…" : "Load payouts"}</button>
        {err && <div className="note err" style={{ marginTop: 8 }}>{err}</div>}
      </section>
    );
  }

  const ready = data.pending.filter((p) => p.ready && p.status === "queued");
  const surplus = BigInt(data.solvency.surplus);
  return (
    <section className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>Company wallet</h2>
        <span className="spacer" />
        <button className="btn sm" onClick={load} disabled={!!busy}>Refresh</button>
        {data.platform.paused
          ? <button className="btn sm primary" onClick={() => pause(false)} disabled={!!busy}>Resume</button>
          : <button className="btn sm" onClick={() => pause(true)} disabled={!!busy}>Emergency pause</button>}
      </div>
      <div className="stats">
        <div><small>Network</small><b>{data.platform.network}</b></div>
        <div><small>Wallet</small><b className="mono">{data.platform.company ? short(data.platform.company) : "not set"}</b></div>
        <div><small>Balance</small><b>{sol(Number(data.solvency.balance), 3)} SOL</b></div>
        <div><small>Owed to users</small><b>{sol(Number(data.solvency.owed), 3)} SOL</b></div>
        <div><small>Surplus</small><b style={{ color: surplus >= 0n ? "var(--green)" : "var(--red)" }}>{sol(Number(data.solvency.surplus), 3)} SOL</b></div>
        <div><small>Payouts</small><b>{data.platform.payoutMode}</b></div>
      </div>
      {surplus < 0n && <div className="note err">The wallet holds less than it owes users. Don&apos;t move funds out; investigate before signing more payouts.</div>}
      {data.platform.paused && <div className="note err">Paused. Deposits are still recorded; filings, orders, the bell and payouts are on hold.</div>}

      <div className="row">
        <h3 style={{ margin: 0 }}>Waiting <span className="muted">{data.pending.length}</span></h3>
        <span className="spacer" />
        <button className="btn sm primary" onClick={signAndSend} disabled={!!busy || !ready.length || data.platform.paused}>
          {busy === "sign" ? "Signing…" : `Sign & send ${Math.min(ready.length, 8)} ready`}
        </button>
      </div>
      {msg && <div className="note ok">{msg}</div>}
      {err && <div className="note err">{err}</div>}
      <div className="admin-list">
        {data.pending.length === 0 && <p className="muted">Nothing owed right now.</p>}
        {data.pending.map((p) => (
          <div key={p.id} className="admin-row">
            <div className="admin-main">
              <span className="admin-name">{KIND[p.kind] ?? p.kind} {p.symbol && <span className="muted mono">${p.symbol}</span>}</span>
              <span className="mono muted">
                to {short(p.to)}
                {BigInt(p.lamports) > 0n && <> · {sol(Number(p.lamports))} SOL</>}
                {BigInt(p.tokens) > 0n && <> · {tokens(Number(p.tokens))} tokens</>}
                {" · "}{p.status === "failed" ? "failed" : p.sig ? "confirming" : p.awaiting ? "awaiting signature" : p.ready ? "ready" : p.notBefore ? `after ${new Date(p.notBefore * 1000).toLocaleString()}` : "waiting on earlier step"}
              </span>
              {p.error && <span className="muted" style={{ fontSize: 12 }}>Last error: {p.error}</span>}
              <Link href={`/launch/${p.launch}`} target="_blank" className="muted" style={{ fontSize: 12 }}>listing</Link>
            </div>
          </div>
        ))}
      </div>

      {data.unattributed.length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>Deposits without a Sipt order <span className="muted">{data.unattributed.length}</span></h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>SOL sent to the company wallet without a valid order memo. Not credited to anyone; refund manually if appropriate.</p>
          <div className="admin-list">
            {data.unattributed.map((u) => (
              <div key={u.sig} className="admin-row"><div className="admin-main">
                <span className="mono">{sol(Number(u.lamports))} SOL from {short(u.from)}</span>
                <span className="muted" style={{ fontSize: 12 }}>{u.memo || "no memo"} · <a href={explorerTx(u.sig)} target="_blank" rel="noreferrer">tx</a></span>
              </div></div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ margin: 0 }}>Recently paid</h3>
      <div className="admin-list">
        {data.recent.map((p) => (
          <div key={p.id} className="admin-row"><div className="admin-main">
            <span>{KIND[p.kind] ?? p.kind} <span className="muted mono">${p.symbol}</span></span>
            <span className="mono muted" style={{ fontSize: 12 }}>to {short(p.to)}{BigInt(p.lamports) > 0n && <> · {sol(Number(p.lamports))} SOL</>}{p.sig && <> · <a href={explorerTx(p.sig)} target="_blank" rel="noreferrer">tx</a></>}</span>
          </div></div>
        ))}
      </div>
    </section>
  );
}
