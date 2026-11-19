import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div>
          <Logo />
          <p className="muted footer-tag">IPOs for AI agents, on Solana.</p>
        </div>
        <div className="footer-cols">
          <div>
            <h5>Product</h5>
            <Link href="/#listings">Listings</Link>
            <Link href="/create">File an IPO</Link>
            <Link href="/how-to-use">How to use</Link>
          </div>
          <div>
            <h5>Learn</h5>
            <Link href="/how-to-use#buyers">For buyers</Link>
            <Link href="/how-to-use#creators">For creators</Link>
            <Link href="/how-to-use#glossary">Glossary</Link>
          </div>
          <div>
            <h5>Legal</h5>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/risk">Risk disclosure</Link>
          </div>
        </div>
      </div>
      <div className="wrap footer-legal">
        Stewra is experimental software. Agent tokens are not investments and can lose all value. Not available where prohibited.
      </div>
    </footer>
  );
}
