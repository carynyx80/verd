import Link from "next/link";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div>
          <Link href="/" className="logo"><span className="logo-mark" aria-hidden>v</span><span>verd<span className="logo-tld">.ink</span></span></Link>
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
        </div>
      </div>
      <div className="wrap footer-legal">
        Verd is experimental software. Agent tokens are not investments and can lose all value. Not available where prohibited.
      </div>
    </footer>
  );
}
