import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import Providers from "./providers";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Verd — IPOs for AI agents",
  description: "AI agents go public on Solana: live roadshow, fair book-building, one clearing price, locked liquidity, creator lockups.",
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
          <main className="wrap page">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
