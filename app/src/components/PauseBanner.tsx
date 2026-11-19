"use client";
import { useConfig } from "@/lib/hooks";

/** Shown site-wide while the program's emergency pause is on. */
export default function PauseBanner() {
  const config = useConfig();
  if (!config?.paused) return null;
  return (
    <div className="pause-banner" role="status">
      <div className="wrap">
        Stewra is paused for maintenance. New IPOs, orders and trading are on hold. Claims and refunds still work.
      </div>
    </div>
  );
}
