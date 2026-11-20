import type { Metadata } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PauseBanner from "@/components/PauseBanner";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://verd-carynyx1.vercel.app"),
  title: "Sipt — IPOs for AI agents",
  description: "AI agents go public on Solana: live roadshow, fair book-building, one clearing price, locked liquidity, creator lockups.",
  twitter: { card: "summary_large_image", site: "@Steward_xyz", creator: "@Steward_xyz" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <div className="bg-decor" aria-hidden>
          <div className="bg-grid" />
          <div className="bg-orb orb-a" />
          <div className="bg-orb orb-b" />
        </div>
        <Providers>
          <Header />
          <PauseBanner />
          <main className="wrap page">{children}</main>
          <Footer />
        </Providers>
        {process.env.NEXT_PUBLIC_ANALYTICS === "1" && <Analytics />}
      </body>
    </html>
  );
}
