import type { ReactNode } from "react";

export const LEGAL_UPDATED = "November 20, 2026";

export default function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <article className="legal">
      <header className="cf-head">
        <h1>{title}</h1>
        <p>{intro}</p>
        <p className="legal-date">Last updated {LEGAL_UPDATED}</p>
      </header>
      <div className="legal-body">{children}</div>
    </article>
  );
}
