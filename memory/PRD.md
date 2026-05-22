# N51ZW Flight Tracker — PRD

## Original Problem Statement
FR24-style live tracker for the 1944 P-51D Mustang **N51ZW** (ICAO24 `a6616a`). Project was originally built on Emergent account `jewer1311@googlemail.com` (out of credits) and partially deployed on base44.app + Vercel. Rebuilt from scratch in account `werner.jedlicsek@gmail.com` based on the MVP specs.

## Architecture
- **Backend** (`/app/backend/server.py`)
  - FastAPI + APScheduler (AsyncIOScheduler) polling OpenSky Network REST API
  - Endpoint `https://opensky-network.org/api/states/all?icao24=a6616a` with HTTP Basic Auth (`Warnherr-P51`) + anonymous fallback
  - State machine emits 4 event types: `takeoff`, `landing`, `signal_lost`, `signal_available`
  - MongoDB collections: `state` (current snapshot), `events` (history), `trail` (positions), `settings` (global config)
  - REST API: `GET /api/aircraft/state`, `GET /api/aircraft/trail`, `GET /api/events`, `GET/PUT /api/settings`, `POST /api/test-event`, `POST /api/poll-now`
- **Frontend** (`/app/frontend/src/App.js`)
  - React 19 + react-leaflet (Leaflet 1.9.4) + Lucide icons
  - Dark aviation theme (Sora + JetBrains Mono fonts, blue accents, glass-morphism cards)
  - Asymmetric layout: 420px sidebar (Mustang hero SVG, status, telemetry grid 4×2, polling selector, alerts toggles, test buttons, event log) + full-height dark Leaflet map (Carto dark tiles)
  - Rotating plane SVG marker following `true_track` heading + dashed blue trail polyline
  - Web Audio API beeps (different frequencies per event type) + browser Notification API for push alerts
  - UI in **German**

## User Personas
- **Werner** (owner / spotter) — wants live awareness when his historic Mustang is in the air; tests alerts via in-app buttons.
- **Public spotters / friends** — read-only viewers (future: share-link feature).

## Core Requirements (Static)
- Track ICAO24 `a6616a` (P-51D Mustang `N51ZW`, 1944) only
- Configurable polling interval 10s–5min (default 5min)
- 4 alert types each with own on/off toggle + master sound/push toggles
- Resilient: anonymous fallback if basic auth fails
- Persist state across backend restarts
- All telemetry in aviation units (ft, kt, fpm, degrees)

## Implemented (May 2026)
- [x] Backend FastAPI with APScheduler polling OpenSky (basic auth verified working with `Warnherr-P51` / user password)
- [x] State machine with takeoff/landing/signal_lost/signal_available events
- [x] MongoDB persistence (state, events, trail, settings)
- [x] 4 in-app Test buttons for previewing alerts
- [x] Frontend dark sidebar + dark Leaflet map with rotating plane icon + dashed trail
- [x] Web Audio Beeps (4 distinct sound profiles) + Browser Push Notifications
- [x] Polling interval selector (10s / 30s / 1min / 2min / 5min)
- [x] Telemetry grid: Altitude (ft), Speed (kt), Heading (°), V/S (fpm), Lat, Lon, Squawk, Origin Country
- [x] Status pills: callsign + auth_mode (BASIC / ANONYMOUS)
- [x] Custom SVG Mustang hero with vapor trail + star marking (no external image dep)
- [x] STANDBY overlay when no live position
- [x] 26/26 backend tests passed (testing_agent_v3 iteration_1.json)
- [x] **Share Live Link** — read-only public route `/share` with full-screen map + minimal floating telemetry/status overlay; QR-code + copy-link modal in Dashboard sidebar (qrcode.react)

## Prioritized Backlog
### P1 — Public / shareability
- [x] ~~Share live link~~ ✅ done
- [ ] Auto-tweet/post when N51ZW takes off (Mastodon / Bluesky / Telegram — needs user choice + token)

### P1 — Reliability
- [ ] Service Worker push notifications (work with tab closed)
- [ ] OpenSky **OAuth2 migration** (basic auth deprecated upstream, still works today)

### P2 — Data depth
- [ ] Altitude / speed history charts (recharts)
- [ ] Airport overlay (departure/arrival annotation)
- [ ] Multi-aircraft favorites (track multiple warbirds at once)

### P2 — UX
- [ ] Clear-events button in UI
- [ ] Replay last flight (animated trail playback)
- [ ] Mobile-optimized bottom-sheet layout

## Next Tasks
1. Confirm with user which P1 feature to tackle next (Share-link vs Auto-tweet vs Service Worker push vs OAuth2)
2. Optionally: switch polling to 30s for active Mustang season once user confirms
