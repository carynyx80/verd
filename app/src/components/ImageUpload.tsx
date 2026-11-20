"use client";
import { useRef, useState } from "react";
import { api, imageUrl } from "@/lib/stewra";

// Let the picker offer any image (incl. iPhone HEIC); the browser normalises it before upload.
const ACCEPT = "image/*,.heic,.heif";
const MAX_SOURCE_BYTES = 40 * 1024 * 1024; // guard against huge files before decoding
const MAX_EDGE: Record<"logo" | "banner", number> = { logo: 1024, banner: 2400 };

/**
 * Decode whatever the browser can open (PNG, JPG, WebP, GIF, HEIC on Safari, files with no
 * MIME type), downscale it, and re-encode as WebP (JPEG where WebP encoding isn't supported).
 * This keeps uploads small regardless of the original size; the server re-encodes again.
 */
async function normalise(file: File, kind: "logo" | "banner"): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
    throw new Error(heic
      ? "This browser can't open HEIC photos. Export the photo as JPG or PNG, or upload from Safari."
      : "That file isn't an image we can read. Use a PNG, JPG, WebP or GIF.");
  }
  const scale = Math.min(1, MAX_EDGE[kind] / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't process this image.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const encode = (type: string, q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  const webp = await encode("image/webp", 0.9);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg", 0.9); // Safari < 17 can't encode WebP
  if (!jpeg) throw new Error("Your browser couldn't process this image.");
  return jpeg;
}

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
    if (file.size > MAX_SOURCE_BYTES) return setErr("Image is too large. Max 40 MB.");
    setBusy(true);
    try {
      const blob = await normalise(file, kind);
      const res = await fetch(api(`/api/uploads?kind=${kind}`), { method: "POST", headers: { "content-type": blob.type }, body: blob });
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
        <span className="ff-hint">{kind === "logo" ? "Square works best, at least 256×256. Any common image format." : "Wide 3:1 image, at least 1500×500."}</span>
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
