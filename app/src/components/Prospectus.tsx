/** Renders the tiny prospectus format: "## Heading", "- bullet", paragraphs. */
export default function Prospectus({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(<ul key={`u${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("#")) { flush(); blocks.push(<h4 key={`h${blocks.length}`}>{line.replace(/^#+\s*/, "")}</h4>); continue; }
    if (/^[-*•]\s+/.test(line)) { bullets.push(line.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "")); continue; }
    flush();
    blocks.push(<p key={`p${blocks.length}`}>{line.replace(/\*\*/g, "")}</p>);
  }
  flush();
  return <div className="prospectus">{blocks}</div>;
}
