"use client";

import { motion } from "framer-motion";

// Animated SVG confidence ring — sweeps to `value`% and colours by band.
export function ConfidenceRing({ value, label, size = 120 }: { value: number; label?: string; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const tone = value >= 85 ? "#10b981" : value >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={7} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={7} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * Math.min(100, Math.max(0, value))) / 100 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
          className="text-2xl font-bold" style={{ color: tone }}>
          {Math.round(value)}%
        </motion.span>
        {label && <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>}
      </div>
    </div>
  );
}
