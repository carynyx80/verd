import Link from "next/link";

/** Stewra mark: two offset tokens stacking into an S. */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo-mark">
      <rect x="10" y="5" width="17" height="10" rx="5" fill="currentColor" />
      <rect x="5" y="17" width="17" height="10" rx="5" fill="currentColor" />
      <circle cx="22" cy="10" r="2" fill="var(--bg)" />
    </svg>
  );
}

export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <Link href="/" className="logo" aria-label="Stewra home">
      <LogoMark size={size} />
      <span>stewra</span>
    </Link>
  );
}
