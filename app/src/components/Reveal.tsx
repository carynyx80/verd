"use client";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

/** Fades and lifts its children into view on scroll (respects reduced motion). */
export default function Reveal({ delay = 0, y = 18, ...props }: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    />
  );
}
