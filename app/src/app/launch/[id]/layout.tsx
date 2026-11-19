import type { Metadata } from "next";
import { fetchProfile } from "@/lib/og";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await fetchProfile(id);
  if (!p || p.hidden) return { title: "Agent IPO — Stewra" };
  const title = `${p.name} ($${p.symbol}) — IPO on Stewra`;
  return {
    title,
    description: p.tagline,
    openGraph: { title, description: p.tagline },
    twitter: { card: "summary_large_image", title, description: p.tagline },
  };
}

export default function LaunchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
