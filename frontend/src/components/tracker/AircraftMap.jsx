import React, { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";

// Default Leaflet icons need fixing for webpack:
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const PLANE_SVG = (heading = 0) => `
<div class="plane-marker-inner" style="transform: rotate(${heading}deg); transform-origin: 50% 50%;">
  <svg width="36" height="36" viewBox="0 0 24 24" fill="#007AFF" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 16v-2l-8-5V3.5C13 2.67 12.33 2 11.5 2S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1L15 22v-1.5L13 19v-5.5L21 16z" stroke="#fff" stroke-width="0.5"/>
  </svg>
</div>`;

function makePlaneIcon(heading) {
  return L.divIcon({
    html: PLANE_SVG(heading || 0),
    className: "plane-marker",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function FlyToAircraft({ position }) {
  const map = useMap();
  const lastRef = useRef(null);
  useEffect(() => {
    if (!position) return;
    const [lat, lng] = position;
    if (
      lastRef.current &&
      Math.abs(lastRef.current[0] - lat) < 0.0005 &&
      Math.abs(lastRef.current[1] - lng) < 0.0005
    ) {
      return;
    }
    lastRef.current = position;
    map.flyTo(position, Math.max(map.getZoom(), 9), { duration: 1.2 });
  }, [position, map]);
  return null;
}

export default function AircraftMap({ snapshot, history }) {
  const hasPos =
    snapshot && snapshot.latitude != null && snapshot.longitude != null;
  const position = hasPos ? [snapshot.latitude, snapshot.longitude] : null;
  const heading = snapshot?.true_track ?? 0;

  const trail = useMemo(() => {
    if (!history) return [];
    return history
      .filter((h) => h.latitude != null && h.longitude != null)
      .map((h) => [h.latitude, h.longitude]);
  }, [history]);

  const icon = useMemo(() => makePlaneIcon(heading), [heading]);

  return (
    <div className="w-full h-full relative" data-testid="aircraft-map">
      <MapContainer
        center={position || [47.5, 13.5]}
        zoom={position ? 9 : 5}
        scrollWheelZoom={true}
        className="w-full h-full"
        style={{ background: "#0a0a0a" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png"
        />
        {trail.length > 1 && (
          <Polyline
            positions={trail}
            pathOptions={{
              color: "#007AFF",
              weight: 2,
              opacity: 0.6,
              dashArray: "4 6",
            }}
          />
        )}
        {position && <Marker position={position} icon={icon} />}
        {position && <FlyToAircraft position={position} />}
      </MapContainer>

      {!hasPos && (
        <div
          data-testid="map-no-signal"
          className="absolute inset-0 z-[400] flex items-center justify-center pointer-events-none"
        >
          <div className="bg-[#141414]/80 backdrop-blur-md border border-white/10 rounded-lg px-6 py-5 text-center max-w-sm">
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#007AFF] mb-2">
              Standby
            </div>
            <div className="text-base text-white mb-1">
              Keine Live-Position
            </div>
            <div className="text-[12px] text-white/50">
              Sobald N51ZW ADS-B Daten sendet, erscheint sie hier auf der Karte.
            </div>
          </div>
        </div>
      )}

      {/* Map overlay header */}
      <div className="absolute top-4 left-4 z-[500] bg-[#141414]/80 backdrop-blur-md border border-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#007AFF] live-dot"></span>
        <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/70">
          Live Tracking · OpenSky
        </span>
      </div>
    </div>
  );
}
