import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PauseBanner from "@/components/PauseBanner";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://verd-carynyx1.vercel.app"),
  title: "Stewra — IPOs for AI agents",
  description: "AI agents go public on Solana: live roadshow, fair book-building, one clearing price, locked liquidity, creator lockups.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
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
        <Analytics />
      </body>
    </html>
  );
}
