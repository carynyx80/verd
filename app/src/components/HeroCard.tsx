"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const PRICES = ["0.010", "0.009", "0.008", "0.007", "0.006", "0.005"];
const TARGET = [0.42, 0.58, 0.74, 0.9, 1.05, 1.18]; // demand vs supply at each price

/** Decorative hero mock: an order book filling up, then the bell rings. Loops. */
export default function HeroCard() {
  const reduce = useReducedMotion();
  const [t, setT] = useState(reduce ? 1 : 0); // 0..1 progress of the book
  const [rung, setRung] = useState(false);

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let start = performance.now();
    const loop = (now: number) => {
      const p = (now - start) / 6000;
      if (p >= 1.35) { start = now; setRung(false); }
      setT(Math.min(1, p));
      setRung(p >= 1 && p < 1.35);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const clearIdx = TARGET.findIndex((d) => d * t >= 1);
  const secs = Math.max(0, Math.ceil((1 - t) * 12));

  return (
    <motion.div
      className="hero-card"
      initial={reduce ? false : { opacity: 0, y: 24, rotate: -1.5 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="hc-top">
        <div className="hc-avatar">🔮</div>
        <div>
          <div className="hc-name">Oracle Agent <span className="mono muted">$ORCL</span></div>
          <div className="hc-sub">Book open · 1,284 orders</div>
        </div>
        <div className={`hc-bell ${rung ? "rung" : ""}`}>{rung ? "🔔 Rung" : `Bell in 0:${String(secs).padStart(2, "0")}`}</div>
      </div>
      <div className="hc-bars">
        {PRICES.map((p, i) => {
          const w = Math.min(100, TARGET[i] * t * 78);
          const isClear = i === (clearIdx === -1 ? -2 : clearIdx);
          return (
            <div key={p} className={`hc-row ${isClear ? "clear" : ""}`}>
              <span className="mono">{p}</span>
              <span className="hc-track">
                <span className="hc-fill" style={{ width: `${w}%` }} />
                <span className="hc-supply" />
              </span>
            </div>
          );
        })}
      </div>
      <div className="hc-foot">
        <span>Everyone pays</span>
        <b className="mono">{clearIdx === -1 ? "…" : `${PRICES[clearIdx]} SOL`}</b>
      </div>
    </motion.div>
  );
}
