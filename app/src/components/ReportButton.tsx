"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/stewra";

const REASONS: [string, string][] = [
  ["impersonation", "Impersonates a person or company"],
  ["scam", "Looks like a scam"],
  ["offensive", "Offensive content"],
  ["copyright", "Uses someone else's work"],
  ["other", "Something else"],
];

export default function ReportButton({ launch }: { launch: string }) {
  const { publicKey } = useWallet();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "err">("idle");
  const [err, setErr] = useState("");
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function send() {
    if (!reason) { setErr("Choose a reason"); return; }
    setState("busy"); setErr("");
    try {
      const res = await fetch(api("/api/reports"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launch, reason, details, reporter: publicKey?.toBase58() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't send the report. Try again.");
      setState("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("err");
    }
  }

  return (
    <span className="report" ref={root}>
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Report</button>
      {open && (
        <div className="report-pop" role="dialog" aria-label="Report this listing">
          {state === "done" ? (
            <p className="report-done">Thanks. A moderator will review this listing.</p>
          ) : (
            <>
              <p className="report-title">Report this listing</p>
              <div className="report-reasons" role="radiogroup">
                {REASONS.map(([k, label]) => (
                  <label key={k} className={reason === k ? "on" : ""}>
                    <input type="radio" name={`reason-${launch}`} value={k} checked={reason === k} onChange={() => { setReason(k); setErr(""); }} />
                    {label}
                  </label>
                ))}
              </div>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} rows={3} placeholder="Add details (optional)" />
              {err && <span className="up-err">{err}</span>}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="btn sm primary" onClick={send} disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send report"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
