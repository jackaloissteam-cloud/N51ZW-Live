# N51ZW Flight Tracker — PRD

## Original Problem Statement
Build a flight tracker for aircraft N51ZW (1944 P-51D Mustang, ICAO24 hex `a6616a`) similar to FlightRadar24's paid version. Alert the user via browser notifications + sound when the aircraft takes off, lands, loses signal, or comes back online. Show live map, telemetry, event log, and settings.

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB), APScheduler for periodic OpenSky polling, single `server.py` file
- **Frontend**: React + react-leaflet + sonner + shadcn UI (dark FR24-style theme)
- **Data source**: OpenSky Network REST API (`/api/states/all?icao24=a6616a`) with HTTP basic auth (user-provided credentials `Warnherr-P51`); anonymous fallback if auth fails

## Core Requirements
- Track single aircraft `a6616a` (N51ZW)
- Poll OpenSky every 10s–5min (default 5min) — server clamps to this range
- Detect events: `takeoff` (ON_GROUND → AIRBORNE), `landing` (AIRBORNE → ON_GROUND), `signal_lost` (timeout > 10min), `signal_available` (NO_SIGNAL → tracked)
- Browser push notifications + Web Audio alarm beeps (configurable patterns per event type)
- Dark FR24-style UI with rotating plane icon on Leaflet map and dark CSS filter on tiles
- Persist all snapshots + events in MongoDB; settings persisted in `flight_settings` singleton document

## Implementation Status (2026-05-17)
- [x] Backend `server.py` with OpenSky client (basic auth + anonymous fallback), APScheduler poller, state machine, MongoDB persistence
- [x] REST endpoints: `/api/`, `/api/aircraft/state`, `/api/aircraft/events`, `/api/aircraft/history`, `/api/settings` (GET/PUT), `/api/aircraft/poll-now`, `/api/aircraft/test-event/{type}`
- [x] Settings model with per-event-type toggles, sound, browser_notifications, poll_interval (10–300s clamp)
- [x] Frontend Tracker page (sidebar + map) with AircraftProfile, FlightDataCard, AlertSettings, EventLog, AircraftMap components
- [x] Browser notification permission flow, audio alarm patterns via Web Audio API
- [x] FR24-dark theme: deep obsidian backgrounds, `#007AFF` blue accents, JetBrains Mono telemetry, Manrope headings
- [x] Backend tested (14/14 pytest cases passed); OpenSky basic auth verified working

## What's Working
- All `/api/*` endpoints
- OpenSky integration (auth_mode=`basic` confirmed by tests)
- Test-event endpoints to validate alarm/notification flow
- Map renders with dark filter, plane marker rotates by heading, trail polyline drawn from history
- Settings persist + immediately reschedule APScheduler job

## Known Notes
- Aircraft N51ZW is a vintage P-51D Mustang and may go long stretches without transmitting ADS-B. When OpenSky returns no state vector, UI shows a `STANDBY · Keine Live-Position` overlay (correct behavior).
- Real takeoff/landing alerts only fire when OpenSky returns state vectors — use test-event buttons for verification.

## Backlog (P1)
- Add manual ICAO24 entry / favorites (track multiple aircraft)
- Speed/altitude charts (recharts) over last hour
- METAR weather overlay near current position
- Persistent push notifications via service worker (works while tab closed)
- Mobile responsive optimization for sidebar collapse

## Backlog (P2)
- Migrate to OpenSky OAuth2 client-credentials flow (basic auth deprecated but still working today)
- Airport overlay layer (closest known airfields)
- Historical flight playback (scrubber over MongoDB snapshots)
- Export event log as CSV
