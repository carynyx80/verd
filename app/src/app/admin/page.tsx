"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { api, short } from "@/lib/stewra";
import PayoutsAdmin from "@/components/PayoutsAdmin";

type Report = { id: string; launch: string; reason: string; details: string; reporter?: string; at: number; resolved?: boolean };
type Data = { reports: Report[]; hidden: Record<string, { at: number; note: string }>; names: Record<string, string> };

const adminMessage = (action: string, launch: string, ts: number) => `Stewra admin\naction: ${action}\nlaunch: ${launch}\nts: ${ts}`;

export default function AdminPage() {
  const { publicKey, signMessage } = useWallet();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  // Every admin request carries a fresh, single-use wallet signature for that exact action.
  const signed = useCallback(async (action: string, launch = "") => {
    if (!publicKey || !signMessage) throw new Error("Connect an admin wallet that can sign messages.");
    const ts = Date.now();
    const sig = await signMessage(new TextEncoder().encode(adminMessage(action, launch, ts)));
    return { wallet: publicKey.toBase58(), signature: bs58.encode(sig), ts, action, launch };
  }, [publicKey, signMessage]);

  async function call(path: string, action: string, launch = "", extra: object = {}) {
    setErr(""); setBusy(action + launch);
    try {
      const res = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(await signed(action, launch)), ...extra }) });
      if (path.endsWith("/export")) {
        if (!res.ok) throw new Error((await res.json()).error);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `stewra-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        return null;
      }
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy("");
    }
  }

  const load = async () => { const d = await call("/api/admin/reports", "list-reports"); if (d) setData(d); };
  const hide = async (launch: string) => { if (await call("/api/admin/hide", "hide", launch, { note })) await load(); };
  const unhide = async (launch: string) => { if (await call("/api/admin/unhide", "unhide", launch)) await load(); };

  const open = data?.reports.filter((r) => !r.resolved) ?? [];
  const byLaunch = open.reduce<Record<string, Report[]>>((acc, r) => ((acc[r.launch] ||= []).push(r), acc), {});

  return (
    <div className="cf admin">
      <header className="cf-head">
        <h1>Admin</h1>
        <p>Company-wallet payouts, emergency pause and moderation. Every action asks your wallet to sign, so only admin wallets can act.</p>
      </header>

      {!data ? (
        <div className="admin-gate">
          <button className="btn primary" onClick={load} disabled={!!busy}>{busy ? "Waiting for signature…" : "Sign in with admin wallet"}</button>
          {!publicKey && <p className="muted">Connect your wallet first.</p>}
          {err && <div className="note err">{err}</div>}
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 24 }}>
          <div className="row">
            <input className="admin-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note saved with the next hide (optional)" maxLength={200} />
            <span className="spacer" />
            <button className="btn sm" onClick={load} disabled={!!busy}>Refresh</button>
            <button className="btn sm" onClick={() => call("/api/admin/export", "export")} disabled={!!busy}>Download backup</button>
          </div>
          {err && <div className="note err">{err}</div>}

          <PayoutsAdmin signed={signed} />

          <section>
            <h2>Open reports <span className="muted">{open.length}</span></h2>
            {Object.keys(byLaunch).length === 0 && <p className="muted">Nothing to review.</p>}
            <div className="admin-list">
              {Object.entries(byLaunch).map(([launch, rs]) => (
                <div key={launch} className="admin-row">
                  <div className="admin-main">
                    <Link href={`/launch/${launch}`} target="_blank" className="admin-name">{data.names[launch] ?? short(launch)}</Link>
                    <span className="mono muted">{short(launch)}</span>
                    <ul>
                      {rs.map((r) => (
                        <li key={r.id}><b>{r.reason}</b>{r.details && <> · {r.details}</>} <span className="muted">· {new Date(r.at).toLocaleString()}</span></li>
                      ))}
                    </ul>
                  </div>
                  <button className="btn sm" onClick={() => hide(launch)} disabled={!!busy || !!data.hidden[launch]}>
                    {data.hidden[launch] ? "Hidden" : busy === "hide" + launch ? "Signing…" : "Hide listing"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>Hidden listings <span className="muted">{Object.keys(data.hidden).length}</span></h2>
            <div className="admin-list">
              {Object.entries(data.hidden).map(([launch, h]) => (
                <div key={launch} className="admin-row">
                  <div className="admin-main">
                    <Link href={`/launch/${launch}`} target="_blank" className="admin-name">{data.names[launch] ?? short(launch)}</Link>
                    <span className="muted">Hidden {new Date(h.at).toLocaleString()}{h.note && <> · {h.note}</>}</span>
                  </div>
                  <button className="btn sm ghost" onClick={() => unhide(launch)} disabled={!!busy}>{busy === "unhide" + launch ? "Signing…" : "Restore"}</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
