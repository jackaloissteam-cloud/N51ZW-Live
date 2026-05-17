import React from "react";

function fmt(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(decimals);
}

function metersToFeet(m) {
  if (m === null || m === undefined) return null;
  return m * 3.28084;
}

function msToKts(v) {
  if (v === null || v === undefined) return null;
  return v * 1.94384;
}

function msToKmh(v) {
  if (v === null || v === undefined) return null;
  return v * 3.6;
}

function DataCell({ label, primary, secondary, testId }) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
        {label}
      </div>
      <div className="tracker-mono text-2xl text-white leading-none">
        {primary}
      </div>
      {secondary !== undefined && (
        <div className="tracker-mono text-[11px] text-white/40">
          {secondary}
        </div>
      )}
    </div>
  );
}

export default function FlightDataCard({ snapshot }) {
  const s = snapshot || {};
  const altM = s.geo_altitude ?? s.baro_altitude;
  const altFt = metersToFeet(altM);
  const velMs = s.velocity;
  const velKts = msToKts(velMs);
  const velKmh = msToKmh(velMs);
  const heading = s.true_track;
  const vsMs = s.vertical_rate;
  const vsFpm = vsMs != null ? vsMs * 196.85 : null; // m/s -> ft/min
  const squawk = s.squawk || "—";

  return (
    <div
      data-testid="flight-data-card"
      className="px-6 py-5 border-b border-white/10"
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50 mb-4">
        Telemetry
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6">
        <DataCell
          testId="data-altitude"
          label="Altitude"
          primary={altFt != null ? `${fmt(altFt)} ft` : "—"}
          secondary={altM != null ? `${fmt(altM)} m` : ""}
        />
        <DataCell
          testId="data-speed"
          label="Speed"
          primary={velKts != null ? `${fmt(velKts)} kts` : "—"}
          secondary={velKmh != null ? `${fmt(velKmh)} km/h` : ""}
        />
        <DataCell
          testId="data-heading"
          label="Heading"
          primary={heading != null ? `${fmt(heading)}°` : "—"}
          secondary={heading != null ? cardinal(heading) : ""}
        />
        <DataCell
          testId="data-vs"
          label="Vertical Rate"
          primary={vsFpm != null ? `${fmt(vsFpm)} fpm` : "—"}
          secondary={vsMs != null ? `${fmt(vsMs, 1)} m/s` : ""}
        />
        <DataCell
          testId="data-squawk"
          label="Squawk"
          primary={squawk}
        />
        <DataCell
          testId="data-position"
          label="Position"
          primary={
            s.latitude != null && s.longitude != null
              ? `${fmt(s.latitude, 3)}, ${fmt(s.longitude, 3)}`
              : "—"
          }
          secondary={s.origin_country || ""}
        />
      </div>
    </div>
  );
}

function cardinal(deg) {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[idx];
}
