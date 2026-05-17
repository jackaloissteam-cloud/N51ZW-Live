import React from "react";

const TYPE_META = {
  takeoff: { label: "Takeoff", color: "border-emerald-500 text-emerald-400" },
  landing: { label: "Landing", color: "border-blue-500 text-blue-400" },
  signal_lost: { label: "Signal Lost", color: "border-red-500 text-red-400" },
  signal_available: {
    label: "Signal Avail.",
    color: "border-amber-500 text-amber-400",
  },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function EventLog({ events }) {
  return (
    <div
      data-testid="event-log"
      className="px-6 py-5 flex-1 min-h-0 flex flex-col"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
          Event Log
        </div>
        <div className="text-[10px] tracker-mono text-white/30">
          {events?.length || 0} entries
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
        {(!events || events.length === 0) && (
          <div
            className="text-[12px] text-white/30 italic py-2"
            data-testid="event-log-empty"
          >
            Keine Ereignisse bisher. Warte auf ADS-B Daten…
          </div>
        )}
        <ul className="space-y-1.5">
          {(events || []).map((ev) => {
            const meta = TYPE_META[ev.event_type] || {
              label: ev.event_type,
              color: "border-white/30 text-white/60",
            };
            return (
              <li
                key={ev.id}
                data-testid={`event-${ev.event_type}`}
                className={`pl-3 py-1.5 border-l-2 ${meta.color} bg-white/[0.02]`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider">
                    {meta.label}
                  </span>
                  <span className="tracker-mono text-[10px] text-white/40">
                    {fmtTime(ev.event_time)}
                  </span>
                </div>
                {ev.details && ev.details.test && (
                  <div className="text-[10px] text-white/30 tracker-mono">
                    (test event)
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
