import React, { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import {
  Plane,
  Activity,
  Bell,
  Gauge,
  Compass,
  ArrowUpRight,
  ArrowDownRight,
  Radio,
  RefreshCw,
  Timer,
  Signal,
  Volume2,
  VolumeX,
} from "lucide-react";
import "./App.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const HERO_IMAGE = null; // we use a CSS+SVG hero instead of external photo for reliability

const POLL_OPTIONS = [
  { v: 10, label: "10s" },
  { v: 30, label: "30s" },
  { v: 60, label: "1min" },
  { v: 120, label: "2min" },
  { v: 300, label: "5min" },
];

// --- Helpers ---------------------------------------------------------------
const fmt = (val, digits = 0) =>
  val === null || val === undefined || Number.isNaN(val) ? "—" : Number(val).toFixed(digits);

const msToKnots = (v) => (v == null ? null : v * 1.9438);
const mToFt = (m) => (m == null ? null : m * 3.28084);
const msToFpm = (v) => (v == null ? null : v * 196.85);

const relTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `vor ${Math.round(diff)}s`;
  if (diff < 3600) return `vor ${Math.round(diff / 60)}min`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)}h`;
  return d.toLocaleString("de-DE");
};

const eventMeta = {
  takeoff: { icon: "🛫", color: "#38d39f", label: "Takeoff" },
  landing: { icon: "🛬", color: "#4ea1ff", label: "Landung" },
  signal_lost: { icon: "📡", color: "#ff5a5f", label: "Signal verloren" },
  signal_available: { icon: "📶", color: "#ffb340", label: "Signal verfügbar" },
};

// --- Web Audio beep -------------------------------------------------------
const beep = (type) => {
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
  } catch (e) {
    /* no-op */
  }
};

const browserPush = (type, note) => {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const meta = eventMeta[type];
  try {
    new Notification(`N51ZW · ${meta.label}`, {
      body: note || meta.label,
      icon: "/favicon.ico",
      silent: false,
    });
  } catch (e) {
    /* no-op */
  }
};

// --- Plane Icon (SVG rotated by track) ------------------------------------
const planeIcon = (heading = 0) =>
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

// --- Map auto-recenter on aircraft ----------------------------------------
function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position && position[0] != null && position[1] != null) {
      map.setView(position, Math.max(map.getZoom(), 7), { animate: true });
    }
  }, [position, map]);
  return null;
}

// --- Telemetry tile -------------------------------------------------------
const Tele = ({ label, value, unit, testid }) => (
  <div className="tele-tile" data-testid={testid}>
    <div className="tele-label">{label}</div>
    <div className="tele-value">
      {value}
      {unit && <span className="tele-unit">{unit}</span>}
    </div>
  </div>
);

// --- Switch ---------------------------------------------------------------
const Switch = ({ on, onChange, testid }) => (
  <div
    className={`tw-switch ${on ? "on" : ""}`}
    onClick={() => onChange(!on)}
    data-testid={testid}
    role="switch"
    aria-checked={on}
  />
);

// --- Main App -------------------------------------------------------------
function App() {
  const [state, setState] = useState(null);
  const [trail, setTrail] = useState([]);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [audioOn, setAudioOn] = useState(true);
  const lastEventIdRef = useRef(null);
  const settingsRef = useRef(null);

  // keep settings ref fresh for the events watcher
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const fetchAll = useCallback(async () => {
    try {
      const [s, t, e, set] = await Promise.all([
        axios.get(`${API}/aircraft/state`),
        axios.get(`${API}/aircraft/trail?limit=200`),
        axios.get(`${API}/events?limit=30`),
        axios.get(`${API}/settings`),
      ]);
      setState(s.data);
      setTrail(t.data);
      setEvents(e.data);
      setSettings(set.data);
    } catch (err) {
      // silent
    }
  }, []);

  // Initial load + UI poll loop (every 5s — backend handles OpenSky poll)
  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Request notification permission on first mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Watch events for new ones → trigger alerts
  useEffect(() => {
    if (!events.length) return;
    const newest = events[0];
    if (lastEventIdRef.current === null) {
      lastEventIdRef.current = newest.id;
      return;
    }
    if (newest.id !== lastEventIdRef.current) {
      lastEventIdRef.current = newest.id;
      const s = settingsRef.current;
      if (!s) return;
      const map = {
        takeoff: s.alerts_takeoff,
        landing: s.alerts_landing,
        signal_lost: s.alerts_signal_lost,
        signal_available: s.alerts_signal_available,
      };
      if (!map[newest.type]) return;
      if (s.sound_enabled && audioOn) beep(newest.type);
      if (s.push_enabled) browserPush(newest.type, newest.note);
    }
  }, [events, audioOn]);

  const triggerTest = async (type) => {
    try {
      await axios.post(`${API}/test-event`, { type });
      await fetchAll();
    } catch (err) {
      /* silent */
    }
  };

  const updateSetting = async (patch) => {
    try {
      const r = await axios.put(`${API}/settings`, patch);
      setSettings(r.data);
    } catch (err) {
      /* silent */
    }
  };

  const pollNow = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/poll-now`);
      await fetchAll();
    } finally {
      setLoading(false);
    }
  };

  const hasPosition = state && state.latitude != null && state.longitude != null;
  const position = hasPosition ? [state.latitude, state.longitude] : null;
  const defaultCenter = [48.1351, 11.582]; // Munich-ish default
  const center = position || defaultCenter;

  const trailLine = trail
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => [p.lat, p.lon]);

  // Status logic
  let statusLabel = "STANDBY";
  let statusPill = "pill-standby";
  let statusDot = "#ffb340";
  if (state?.has_signal && state?.in_flight) {
    statusLabel = "IN FLIGHT";
    statusPill = "pill-live";
    statusDot = "#38d39f";
  } else if (state?.has_signal && !state?.in_flight) {
    statusLabel = "ON GROUND";
    statusPill = "pill-live";
    statusDot = "#4ea1ff";
  } else if (!state?.has_signal) {
    statusLabel = "STANDBY";
    statusPill = "pill-standby";
    statusDot = "#ffb340";
  }

  return (
    <div className="shell" data-testid="app-shell">
      {/* SIDEBAR */}
      <aside className="sidebar" data-testid="sidebar">
        {/* Hero */}
        <div className="hero" data-testid="hero">
          {/* Cinematic CSS gradient + SVG Mustang silhouette */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse at 70% 30%, rgba(78,161,255,0.25) 0%, rgba(78,161,255,0.05) 40%, transparent 70%), radial-gradient(ellipse at 30% 80%, rgba(255,179,64,0.12) 0%, transparent 50%), linear-gradient(135deg, #0a1320 0%, #050608 80%)",
            }}
          />
          {/* Subtle horizon line */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "65%",
              height: 1,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(78,161,255,0.4) 50%, transparent 100%)",
              opacity: 0.6,
            }}
          />
          {/* Mustang SVG silhouette */}
          <svg
            viewBox="0 0 600 220"
            preserveAspectRatio="xMidYMid slice"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              filter: "drop-shadow(0 8px 24px rgba(78,161,255,0.4))",
            }}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="planeGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1a2434" />
                <stop offset="60%" stopColor="#0e1622" />
                <stop offset="100%" stopColor="#050608" />
              </linearGradient>
              <linearGradient id="planeHighlight" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(78,161,255,0.7)" />
                <stop offset="100%" stopColor="rgba(78,161,255,0)" />
              </linearGradient>
            </defs>
            {/* Fuselage */}
            <g transform="translate(140 70) rotate(-8)">
              {/* Wing */}
              <path
                d="M -120 30 L 280 25 L 320 35 L 280 45 L -110 50 Z"
                fill="url(#planeGrad)"
                stroke="rgba(78,161,255,0.35)"
                strokeWidth="0.6"
              />
              {/* Body */}
              <path
                d="M 0 0 L 280 20 L 320 35 L 300 50 L 280 50 L 0 65 L -30 50 L -40 35 L -30 20 Z"
                fill="url(#planeGrad)"
                stroke="rgba(78,161,255,0.4)"
                strokeWidth="0.8"
              />
              {/* Canopy */}
              <ellipse cx="60" cy="22" rx="40" ry="9" fill="rgba(120,180,255,0.25)" stroke="rgba(120,180,255,0.5)" strokeWidth="0.5" />
              {/* Highlight */}
              <path
                d="M 0 5 L 280 22 L 280 28 L 0 12 Z"
                fill="url(#planeHighlight)"
                opacity="0.4"
              />
              {/* Propeller hub */}
              <circle cx="-38" cy="35" r="6" fill="#1a2434" stroke="rgba(78,161,255,0.5)" strokeWidth="0.6" />
              {/* Propeller blur */}
              <ellipse cx="-38" cy="35" rx="3" ry="32" fill="rgba(78,161,255,0.18)" />
              {/* Tail vertical */}
              <path d="M 300 35 L 320 5 L 326 5 L 318 35 Z" fill="url(#planeGrad)" stroke="rgba(78,161,255,0.4)" strokeWidth="0.6" />
              {/* Tail horizontal */}
              <path d="M 295 30 L 340 28 L 350 35 L 340 42 L 295 40 Z" fill="url(#planeGrad)" stroke="rgba(78,161,255,0.4)" strokeWidth="0.6" />
              {/* Star marking */}
              <circle cx="150" cy="35" r="9" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
              <polygon points="150,28 152,33 157,33 153,36 154,41 150,38 146,41 147,36 143,33 148,33" fill="rgba(255,255,255,0.7)" />
            </g>
            {/* Vapor trail */}
            <path
              d="M 100 100 Q 250 110 580 95"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="20"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 100 100 Q 250 110 580 95"
              stroke="rgba(78,161,255,0.15)"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="2 8"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              display: "flex",
              gap: 6,
              zIndex: 2,
            }}
          >
            <span className={`pill ${statusPill}`} data-testid="status-pill">
              <span
                className="pulse-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: statusDot,
                  display: "inline-block",
                }}
              />
              {state?.callsign || "UNKNOWN"}
            </span>
            <span className="pill" style={{ fontSize: 10 }} data-testid="auth-pill">
              {state?.auth_mode || "—"}
            </span>
          </div>
          <div
            style={{
              position: "absolute",
              left: 22,
              bottom: 16,
              zIndex: 2,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.28em",
                color: "var(--accent-blue)",
                fontWeight: 600,
              }}
            >
              {state?.aircraft_type || "P-51D MUSTANG"} · {state?.year || "1944"}
            </div>
            <div
              className="glow-blue"
              style={{
                fontSize: 38,
                fontWeight: 800,
                letterSpacing: "0.04em",
                lineHeight: 1.05,
                marginTop: 4,
              }}
              data-testid="tail-number"
            >
              {state?.tail_number || "N51ZW"}
            </div>
          </div>
        </div>

        {/* Status block */}
        <div style={{ padding: "20px 22px 8px" }}>
          <div className="section-title">Status</div>
          <div
            className="card-aviation"
            style={{ padding: 16, marginBottom: 18 }}
            data-testid="status-card"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  color: "var(--accent-blue)",
                  fontWeight: 600,
                }}
              >
                {statusLabel}
              </div>
              <button
                onClick={pollNow}
                className="btn-base"
                style={{ padding: "4px 10px", fontSize: 10 }}
                data-testid="refresh-btn"
              >
                <RefreshCw size={11} className={loading ? "prop-spin" : ""} />
                Refresh
              </button>
            </div>
            <div
              style={{
                fontSize: 14,
                color: "var(--text-primary)",
                fontWeight: 500,
                marginBottom: 4,
              }}
              data-testid="status-headline"
            >
              {state?.has_signal
                ? state?.in_flight
                  ? "Mustang in der Luft"
                  : "Mustang am Boden · ADS-B aktiv"
                : "Keine Live-Position"}
            </div>
            <div
              style={{ fontSize: 11, color: "var(--text-muted)" }}
              data-testid="status-subtext"
            >
              {state?.has_signal
                ? `Letzter Kontakt ${relTime(state?.last_seen)}`
                : "Sobald N51ZW ADS-B Daten sendet, erscheint sie hier."}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                marginTop: 8,
                fontFamily: "JetBrains Mono, monospace",
                letterSpacing: "0.06em",
              }}
            >
              POLL · {relTime(state?.last_poll)} · ICAO24 {state?.icao24 || "—"}
            </div>
          </div>

          {/* Telemetry */}
          <div className="section-title">Telemetrie</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              marginBottom: 18,
            }}
            data-testid="telemetry-grid"
          >
            <Tele
              testid="tele-alt"
              label="Altitude"
              value={fmt(mToFt(state?.baro_altitude), 0)}
              unit="ft"
            />
            <Tele
              testid="tele-speed"
              label="Speed"
              value={fmt(msToKnots(state?.velocity), 0)}
              unit="kt"
            />
            <Tele
              testid="tele-track"
              label="Heading"
              value={fmt(state?.true_track, 0)}
              unit="°"
            />
            <Tele
              testid="tele-vrate"
              label="V/S"
              value={fmt(msToFpm(state?.vertical_rate), 0)}
              unit="fpm"
            />
            <Tele
              testid="tele-lat"
              label="Lat"
              value={fmt(state?.latitude, 4)}
              unit="°"
            />
            <Tele
              testid="tele-lon"
              label="Lon"
              value={fmt(state?.longitude, 4)}
              unit="°"
            />
            <Tele
              testid="tele-squawk"
              label="Squawk"
              value={state?.squawk || "—"}
              unit=""
            />
            <Tele
              testid="tele-origin"
              label="Origin"
              value={state?.origin_country || "—"}
              unit=""
            />
          </div>

          {/* Polling interval */}
          <div className="section-title">Polling-Intervall</div>
          <div
            style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}
            data-testid="poll-buttons"
          >
            {POLL_OPTIONS.map((o) => (
              <button
                key={o.v}
                className={`btn-base ${
                  settings?.poll_interval_seconds === o.v ? "btn-primary" : ""
                }`}
                style={{ padding: "5px 11px", fontSize: 11 }}
                onClick={() => updateSetting({ poll_interval_seconds: o.v })}
                data-testid={`poll-btn-${o.v}`}
              >
                <Timer size={11} />
                {o.label}
              </button>
            ))}
          </div>

          {/* Alerts */}
          <div className="section-title">Alarme</div>
          <div
            className="card-aviation"
            style={{ padding: 14, marginBottom: 18 }}
            data-testid="alerts-card"
          >
            {[
              { k: "alerts_takeoff", label: "Takeoff", icon: "🛫" },
              { k: "alerts_landing", label: "Landung", icon: "🛬" },
              { k: "alerts_signal_lost", label: "Signal verloren", icon: "📡" },
              { k: "alerts_signal_available", label: "Signal verfügbar", icon: "📶" },
            ].map((row) => (
              <div
                key={row.k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 0",
                  fontSize: 12,
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ color: "var(--text-secondary)" }}>
                  <span style={{ marginRight: 6 }}>{row.icon}</span>
                  {row.label}
                </span>
                <Switch
                  on={!!settings?.[row.k]}
                  onChange={(v) => updateSetting({ [row.k]: v })}
                  testid={`switch-${row.k}`}
                />
              </div>
            ))}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 0",
                fontSize: 12,
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>
                <Volume2 size={12} style={{ marginRight: 6, verticalAlign: -2 }} />
                Sound (Web Audio Beep)
              </span>
              <Switch
                on={!!settings?.sound_enabled}
                onChange={(v) => updateSetting({ sound_enabled: v })}
                testid="switch-sound"
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 0",
                fontSize: 12,
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>
                <Bell size={12} style={{ marginRight: 6, verticalAlign: -2 }} />
                Browser Push Notification
              </span>
              <Switch
                on={!!settings?.push_enabled}
                onChange={(v) => updateSetting({ push_enabled: v })}
                testid="switch-push"
              />
            </div>
          </div>

          {/* Test buttons */}
          <div className="section-title">Test-Alarme</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              marginBottom: 18,
            }}
            data-testid="test-buttons"
          >
            <button
              className="btn-base"
              style={{ fontSize: 11 }}
              onClick={() => triggerTest("takeoff")}
              data-testid="test-takeoff"
            >
              🛫 Takeoff
            </button>
            <button
              className="btn-base"
              style={{ fontSize: 11 }}
              onClick={() => triggerTest("landing")}
              data-testid="test-landing"
            >
              🛬 Landung
            </button>
            <button
              className="btn-base"
              style={{ fontSize: 11 }}
              onClick={() => triggerTest("signal_lost")}
              data-testid="test-signal-lost"
            >
              📡 Signal lost
            </button>
            <button
              className="btn-base"
              style={{ fontSize: 11 }}
              onClick={() => triggerTest("signal_available")}
              data-testid="test-signal-available"
            >
              📶 Signal back
            </button>
          </div>

          {/* Event log */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <div className="section-title" style={{ marginBottom: 0 }}>
              Event Log
            </div>
            <button
              className="btn-base"
              style={{ padding: "2px 8px", fontSize: 10 }}
              onClick={() => setAudioOn(!audioOn)}
              data-testid="audio-toggle"
            >
              {audioOn ? <Volume2 size={11} /> : <VolumeX size={11} />}
              {audioOn ? "on" : "muted"}
            </button>
          </div>
          <div
            className="card-aviation"
            style={{ padding: "8px 14px", marginBottom: 22 }}
            data-testid="event-log"
          >
            {events.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  padding: "16px 0",
                  textAlign: "center",
                }}
              >
                Noch keine Events erfasst
              </div>
            )}
            {events.map((ev) => {
              const meta = eventMeta[ev.type] || {};
              return (
                <div key={ev.id} className="event-row" data-testid={`event-${ev.type}`}>
                  <div className="event-icon" style={{ background: `${meta.color}22`, color: meta.color }}>
                    {meta.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: "var(--text-primary)",
                        fontWeight: 500,
                        fontSize: 12,
                      }}
                    >
                      {meta.label || ev.type}
                    </div>
                    <div
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 10,
                        fontFamily: "JetBrains Mono, monospace",
                        marginTop: 2,
                      }}
                    >
                      {relTime(ev.timestamp)}
                      {ev.note ? ` · ${ev.note}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* MAP */}
      <main
        style={{ position: "relative", height: "100vh", width: "100%" }}
        data-testid="map-area"
      >
        <MapContainer
          center={center}
          zoom={position ? 7 : 4}
          style={{ width: "100%", height: "100%" }}
          zoomControl={true}
          attributionControl={true}
          worldCopyJump={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · &copy; <a href="https://carto.com/">CARTO</a>'
            subdomains="abcd"
            maxZoom={19}
          />
          {trailLine.length > 1 && (
            <Polyline
              positions={trailLine}
              pathOptions={{
                color: "#4ea1ff",
                weight: 2.5,
                opacity: 0.85,
                dashArray: "6 6",
              }}
            />
          )}
          {position && (
            <>
              <Marker position={position} icon={planeIcon(state?.true_track || 0)} />
              <Recenter position={position} />
            </>
          )}
        </MapContainer>

        {/* Overlay HUD: Live tracking badge */}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 18,
            zIndex: 500,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div
            className="card-aviation"
            style={{
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            data-testid="live-badge"
          >
            <Radio
              size={13}
              color={state?.has_signal ? "#38d39f" : "#ffb340"}
              className={state?.has_signal ? "pulse-dot" : ""}
              style={{ borderRadius: 99, padding: 0 }}
            />
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                fontWeight: 600,
                color: "var(--text-primary)",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              LIVE TRACKING · OPENSKY
            </span>
          </div>
        </div>

        {/* No-position overlay */}
        {!hasPosition && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 500,
              padding: "22px 32px",
              textAlign: "center",
              pointerEvents: "none",
            }}
            className="card-aviation"
            data-testid="no-position-overlay"
          >
            <Plane
              size={32}
              color="#4ea1ff"
              style={{ marginBottom: 10, opacity: 0.7 }}
            />
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.28em",
                color: "var(--accent-amber)",
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              STANDBY
            </div>
            <div
              style={{
                fontSize: 18,
                color: "var(--text-primary)",
                fontWeight: 500,
                marginBottom: 6,
              }}
            >
              Keine Live-Position
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                maxWidth: 320,
              }}
            >
              Sobald N51ZW ADS-B Daten sendet, erscheint sie hier auf der Karte.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
