export const X_URL = "https://x.com/Steward_xyz";
export const X_HANDLE = "@Steward_xyz";

/** The X (Twitter) logo as an inline icon. */
export function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Compact icon link for the header. */
export default function XLink() {
  return (
    <a className="x-link" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label={`Sipt on X (${X_HANDLE})`} title={`Follow ${X_HANDLE} on X`}>
      <XIcon />
    </a>
  );
}
