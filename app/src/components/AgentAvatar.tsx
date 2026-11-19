import { imageUrl } from "@/lib/stewra";

/** Agent logo if uploaded, otherwise the legacy emoji, otherwise a neutral glyph. */
export default function AgentAvatar({ logo, emoji, className = "avatar" }: { logo?: string; emoji?: string; className?: string }) {
  if (logo) {
    return (
      <div className={`${className} has-img`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(logo)} alt="" loading="lazy" />
      </div>
    );
  }
  return <div className={className}>{emoji ?? "🤖"}</div>;
}
