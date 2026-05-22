// Shared helpers + constants for N51ZW Tracker
import L from "leaflet";

export const POLL_OPTIONS = [
  { v: 10, label: "10s" },
  { v: 30, label: "30s" },
  { v: 60, label: "1min" },
  { v: 120, label: "2min" },
  { v: 300, label: "5min" },
];

export const fmt = (val, digits = 0) =>
  val === null || val === undefined || Number.isNaN(val) ? "—" : Number(val).toFixed(digits);

export const msToKnots = (v) => (v == null ? null : v * 1.9438);
export const mToFt = (m) => (m == null ? null : m * 3.28084);
export const msToFpm = (v) => (v == null ? null : v * 196.85);

export const relTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `vor ${Math.round(diff)}s`;
  if (diff < 3600) return `vor ${Math.round(diff / 60)}min`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)}h`;
  return d.toLocaleString("de-DE");
};

export const eventMeta = {
  takeoff: { icon: "🛫", color: "#38d39f", label: "Takeoff" },
  landing: { icon: "🛬", color: "#4ea1ff", label: "Landung" },
  signal_lost: { icon: "📡", color: "#ff5a5f", label: "Signal verloren" },
  signal_available: { icon: "📶", color: "#ffb340", label: "Signal verfügbar" },
};

export const beep = (type) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    const profiles = {
      takeoff: [880, 1320],
      landing: [660, 440],
      signal_lost: [320, 220],
      signal_available: [660, 880],
    };
    const [f1, f2] = profiles[type] || [600, 800];
    o.frequency.setValueAtTime(f1, ctx.currentTime);
    o.frequency.linearRampToValueAtTime(f2, ctx.currentTime + 0.35);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start();
    o.stop(ctx.currentTime + 0.55);
  } catch (e) { /* no-op */ }
};

export const browserPush = (type, note) => {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const meta = eventMeta[type];
  try {
    new Notification(`N51ZW · ${meta.label}`, {
      body: note || meta.label,
      icon: "/favicon.ico",
      silent: false,
    });
  } catch (e) { /* no-op */ }
};

export const planeIcon = (heading = 0) =>
  L.divIcon({
    className: "plane-marker",
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<div style="transform: rotate(${heading}deg); width:48px; height:48px; display:flex; align-items:center; justify-content:center;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L13.5 9.5L22 11L13.5 12.5L12 22L10.5 12.5L2 11L10.5 9.5L12 2Z" fill="#4ea1ff" stroke="#fff" stroke-width="0.6" stroke-linejoin="round"/>
      </svg>
    </div>`,
  });
