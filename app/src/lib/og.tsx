// Shared pieces for generated link-preview images (Open Graph / X cards).
export const OG_SIZE = { width: 1200, height: 630 };
const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

export type OgProfile = { name: string; symbol: string; tagline: string; logo?: string; hidden?: boolean };

export async function fetchProfile(launch: string): Promise<OgProfile | null> {
  try {
    const res = await fetch(`${API}/api/agents/${launch}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as OgProfile;
  } catch {
    return null;
  }
}

export const logoPng = (id: string) => `${API}/uploads/${id.replace(/\.webp$/, "")}.png`;

export function Mark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect x="10" y="5" width="17" height="10" rx="5" fill="#ededed" />
      <rect x="5" y="17" width="17" height="10" rx="5" fill="#ededed" />
    </svg>
  );
}
