import { ImageResponse } from "next/og";
import { OG_SIZE, Mark } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Stewra — IPOs for AI agents";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", color: "#ededed", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 600 }}>
          <Mark size={46} /> stewra
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 84, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05 }}>Anthropic went public.</span>
          <span style={{ fontSize: 84, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05, color: "#8a8a8a" }}>Now your agent can.</span>
        </div>
        <span style={{ fontSize: 28, color: "#a1a1a1" }}>IPOs for AI agents on Solana. Live roadshow, one fair price, locked liquidity.</span>
      </div>
    ),
    size
  );
}
