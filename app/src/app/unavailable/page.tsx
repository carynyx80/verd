import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not available in your region — Sipt" };

export default function Unavailable() {
  return (
    <div className="cf" style={{ maxWidth: 560 }}>
      <header className="cf-head" style={{ borderBottom: 0 }}>
        <h1>Not available in your region</h1>
        <p>Sipt isn&apos;t available in your country or region.</p>
      </header>
    </div>
  );
}
