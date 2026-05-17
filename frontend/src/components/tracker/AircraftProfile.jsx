import React from "react";
import StatusBadge from "@/components/tracker/StatusBadge";

const P51D_IMG =
  "https://static.prod-images.emergentagent.com/jobs/c51e277c-316b-4cc1-bc96-2d1481ad6dfd/images/256233b755a90fe89c87adf7fb3eb2c48d144ad3075f3d9e2d63f047127f1282.png";

export default function AircraftProfile({ state }) {
  const reg = state?.registration || "N51ZW";
  const icao24 = (state?.icao24 || "a6616a").toUpperCase();
  const callsign = state?.last_snapshot?.callsign || "—";

  return (
    <div
      data-testid="aircraft-profile"
      className="border-b border-white/10 bg-[#0a0a0a]"
    >
      <div className="relative h-44 overflow-hidden">
        <img
          src={P51D_IMG}
          alt="P-51D Mustang"
          className="w-full h-full object-cover opacity-90"
          data-testid="aircraft-image"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent"></div>
        <div className="absolute top-3 right-3">
          <StatusBadge
            state={state?.current_state}
            lastPollSuccess={state?.last_poll_success}
            authMode={state?.auth_mode}
          />
        </div>
      </div>
      <div className="px-6 py-5 flex flex-col gap-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#007AFF]">
          P-51D Mustang · 1944
        </div>
        <h1
          className="tracker-heading text-3xl font-extrabold tracking-tight text-white"
          data-testid="registration"
        >
          {reg}
        </h1>
        <div className="flex items-center gap-3 text-[11px] text-white/50 tracker-mono">
          <span data-testid="icao24">ICAO {icao24}</span>
          <span className="text-white/20">·</span>
          <span data-testid="callsign">CS {callsign}</span>
        </div>
      </div>
    </div>
  );
}
