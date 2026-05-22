import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import { Plane, Radio, Gauge, Compass, ArrowUpRight } from "lucide-react";
import {
  fmt,
  msToKnots,
  mToFt,
  relTime,
  planeIcon,
} from "../lib/tracker";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position && position[0] != null && position[1] != null) {
      map.setView(position, Math.max(map.getZoom(), 7), { animate: true });
    }
  }, [position, map]);
  return null;
}

export default function ShareView() {
  const [state, setState] = useState(null);
  const [trail, setTrail] = useState([]);

  const fetchAll = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        axios.get(`${API}/aircraft/state`),
        axios.get(`${API}/aircraft/trail?limit=200`),
      ]);
      setState(s.data);
      setTrail(t.data);
    } catch (e) { /* silent */ }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 7000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const hasPosition = state && state.latitude != null && state.longitude != null;
  const position = hasPosition ? [state.latitude, state.longitude] : null;
  const center = position || [48.1351, 11.582];

  const trailLine = trail
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => [p.lat, p.lon]);

  let statusLabel = "STANDBY";
  let statusColor = "#ffb340";
  if (state?.has_signal && state?.in_flight) {
    statusLabel = "IN FLIGHT";
    statusColor = "#38d39f";
  } else if (state?.has_signal) {
    statusLabel = "ON GROUND";
    statusColor = "#4ea1ff";
  }

  return (
    <div
      data-testid="share-view"
      style={{ position: "relative", height: "100vh", width: "100vw", overflow: "hidden" }}
    >
      {/* Full screen map */}
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> · &copy; <a href="https://carto.com/">CARTO</a>'
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

      {/* Top-left header */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 18,
          zIndex: 500,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
        data-testid="share-header"
      >
        <div
          className="card-aviation"
          style={{
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Plane size={20} color="#4ea1ff" />
          <div>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.28em",
                color: "var(--accent-blue)",
                fontWeight: 600,
              }}
            >
              P-51D MUSTANG · 1944
            </div>
            <div
              className="glow-blue"
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "0.04em",
                lineHeight: 1,
                marginTop: 2,
              }}
              data-testid="share-tail"
            >
              {state?.tail_number || "N51ZW"}
            </div>
          </div>
        </div>
        <div
          className="card-aviation"
          style={{
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          data-testid="share-status"
        >
          <Radio
            size={12}
            color={statusColor}
            className={state?.has_signal ? "pulse-dot" : ""}
            style={{ borderRadius: 99 }}
          />
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.22em",
                color: statusColor,
                fontWeight: 700,
              }}
            >
              {statusLabel}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                fontFamily: "JetBrains Mono, monospace",
                marginTop: 1,
              }}
            >
              POLL · {relTime(state?.last_poll)}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-left telemetry mini panel */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 18,
          zIndex: 500,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          maxWidth: "min(540px, calc(100vw - 36px))",
        }}
        data-testid="share-telemetry"
      >
        {[
          { label: "ALT", value: fmt(mToFt(state?.baro_altitude)), unit: "ft", icon: ArrowUpRight },
          { label: "SPEED", value: fmt(msToKnots(state?.velocity)), unit: "kt", icon: Gauge },
          { label: "HDG", value: fmt(state?.true_track), unit: "°", icon: Compass },
          { label: "LAT", value: fmt(state?.latitude, 3), unit: "°", icon: null },
          { label: "LON", value: fmt(state?.longitude, 3), unit: "°", icon: null },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="card-aviation"
              style={{
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {Icon && <Icon size={12} color="var(--text-muted)" />}
              <div>
                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.18em",
                    color: "var(--text-muted)",
                    fontWeight: 600,
                  }}
                >
                  {m.label}
                </div>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    lineHeight: 1,
                    marginTop: 2,
                  }}
                >
                  {m.value}
                  <span
                    style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 3 }}
                  >
                    {m.unit}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Read-only badge / share branding (bottom-right) */}
      <div
        style={{
          position: "absolute",
          bottom: 18,
          right: 18,
          zIndex: 500,
        }}
        data-testid="share-badge"
      >
        <div
          className="card-aviation"
          style={{
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            letterSpacing: "0.22em",
            color: "var(--text-secondary)",
            fontWeight: 600,
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          <Radio size={11} color="#4ea1ff" />
          LIVE · READ-ONLY · OPENSKY
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
          data-testid="share-no-position"
        >
          <Plane size={32} color="#4ea1ff" style={{ marginBottom: 10, opacity: 0.7 }} />
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
          <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 320 }}>
            Sobald N51ZW ADS-B Daten sendet, erscheint sie hier auf der Karte.
          </div>
        </div>
      )}
    </div>
  );
}
