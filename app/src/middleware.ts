import { NextResponse, type NextRequest } from "next/server";

// Optional geoblocking. Set BLOCKED_COUNTRIES on Vercel to a comma-separated list of
// ISO country codes (e.g. "US,KP,IR"). Empty means no blocking.
const BLOCKED = (process.env.BLOCKED_COUNTRIES || "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);

export function middleware(req: NextRequest) {
  if (BLOCKED.length === 0) return NextResponse.next();
  const country = (req.headers.get("x-vercel-ip-country") || "").toUpperCase();
  if (country && BLOCKED.includes(country) && !req.nextUrl.pathname.startsWith("/unavailable")) {
    return NextResponse.rewrite(new URL("/unavailable", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|icon.svg|favicon.ico|unavailable|terms|privacy|risk).*)"],
};
