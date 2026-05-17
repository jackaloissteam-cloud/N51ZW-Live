import React from "react";

const VARIANTS = {
  AIRBORNE: {
    label: "In Flight",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    dot: "bg-emerald-400",
  },
  ON_GROUND: {
    label: "On Ground",
    bg: "bg-zinc-500/15",
    text: "text-zinc-300",
    border: "border-zinc-500/40",
    dot: "bg-zinc-300",
  },
  NO_SIGNAL: {
    label: "Signal Lost",
    bg: "bg-red-500/15",
    text: "text-red-400",
    border: "border-red-500/40",
    dot: "bg-red-400",
  },
  NO_DATA: {
    label: "No Data",
    bg: "bg-yellow-500/15",
    text: "text-yellow-400",
    border: "border-yellow-500/40",
    dot: "bg-yellow-400",
  },
  UNKNOWN: {
    label: "Unknown",
    bg: "bg-zinc-500/10",
    text: "text-zinc-400",
    border: "border-zinc-500/30",
    dot: "bg-zinc-400",
  },
};

export default function StatusBadge({ state, lastPollSuccess, authMode }) {
  const v = VARIANTS[state] || VARIANTS.UNKNOWN;
  return (
    <div
      data-testid="status-badge"
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.2em] border ${v.bg} ${v.text} ${v.border}`}
    >
      <span className={`w-2 h-2 rounded-full ${v.dot} live-dot`}></span>
      <span data-testid="status-label">{v.label}</span>
      {authMode && (
        <span className="ml-1 text-[9px] tracking-[0.15em] text-white/40 font-normal lowercase">
          · {authMode}
          {lastPollSuccess ? "" : " · err"}
        </span>
      )}
    </div>
  );
}
