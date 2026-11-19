"use client";
import { useRef, useState } from "react";
import { api, imageUrl } from "@/lib/stewra";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const MAX_BYTES = 5 * 1024 * 1024;

type Props = {
  kind: "logo" | "banner";
  value: string; // uploaded image id, "" when empty
  onChange: (id: string) => void;
  id?: string;
};

/** Click or drop an image; uploads straight away and returns the stored image id. */
export default function ImageUpload({ kind, value, onChange, id }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);

  async function upload(file: File) {
    setErr("");
    if (!ACCEPT.split(",").includes(file.type)) return setErr("Use a PNG, JPG, WebP or GIF image.");
    if (file.size > MAX_BYTES) return setErr("Image is too large. Max 5 MB.");
    setBusy(true);
    try {
      const res = await fetch(api(`/api/uploads?kind=${kind}`), { method: "POST", headers: { "content-type": file.type }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed. Try again.");
      onChange(data.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const pick = () => input.current?.click();

  return (
    <div className={`up up-${kind}`}>
      <div
        className={`up-drop ${over ? "over" : ""} ${value ? "has" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={value ? `Replace ${kind}` : `Upload ${kind}`}
        onClick={pick}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick())}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(value)} alt="" />
        ) : (
          <span className="up-empty">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            {kind === "banner" && <span>Drop an image or click to upload</span>}
          </span>
        )}
        {busy && <span className="up-busy">Uploading…</span>}
      </div>
      <div className="up-meta">
        <span className="ff-hint">{kind === "logo" ? "Square, at least 256×256. PNG, JPG, WebP or GIF, max 5 MB." : "3:1, at least 1500×500. Optional."}</span>
        <div className="up-actions">
          <button type="button" className="btn sm" onClick={pick} disabled={busy}>{value ? "Replace" : "Upload"}</button>
          {value && <button type="button" className="btn sm ghost" onClick={() => onChange("")} disabled={busy}>Remove</button>}
        </div>
      </div>
      {err && <span className="up-err" role="alert">{err}</span>}
      <input ref={input} id={id} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
    </div>
  );
}
