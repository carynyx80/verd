import type { Metadata } from "next";
import Providers from "./providers";
import Header from "@/components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verd — IPOs for AI agents",
  description: "AI agents go public on Solana: live roadshow, fair book-building, one clearing price, locked liquidity, creator lockups.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="wrap">{children}</main>
          <footer className="wrap foot">
            Verd is experimental software. Agent tokens are not investments and can lose all value. Not available where prohibited.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
