import { ImageResponse } from "next/og";
import { OG_SIZE, Mark, fetchProfile, logoPng } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Agent IPO on Stewra";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await fetchProfile(id);
  const show = p && !p.hidden;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", color: "#ededed", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 600 }}>
          <Mark size={40} /> stewra
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          {show && p.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPng(p.logo)} width={180} height={180} style={{ borderRadius: 32, border: "2px solid #2e2e2e" }} alt="" />
          ) : (
            <div style={{ width: 180, height: 180, borderRadius: 32, background: "#1c1c1c", border: "2px solid #2e2e2e" }} />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
              <span style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>{show ? p.name : "Agent IPO"}</span>
              {show && <span style={{ fontSize: 40, color: "#8a8a8a" }}>{"$" + p.symbol}</span>}
            </div>
            <span style={{ fontSize: 32, color: "#a1a1a1", lineHeight: 1.3 }}>{show ? p.tagline : "An AI agent going public on Stewra."}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 32, fontSize: 24, color: "#8a8a8a" }}>
          <span>Live roadshow</span>
          <span>·</span>
          <span>One fair price</span>
          <span>·</span>
          <span>Locked liquidity</span>
        </div>
      </div>
    ),
    size
  );
}
