"use client";
import { useConfig } from "@/lib/hooks";

/** Shown site-wide while the operator's emergency pause is on. */
export default function PauseBanner() {
  const config = useConfig();
  if (!config?.paused) return null;
  return (
    <div className="pause-banner" role="status">
      <div className="wrap">
        Sipt is paused for maintenance. New IPOs, orders and payouts from the company wallet are on hold. Funds already deposited stay recorded and will be paid out when we resume.
      </div>
    </div>
  );
}
