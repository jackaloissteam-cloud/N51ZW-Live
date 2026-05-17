"""N51ZW Flight Tracker backend.

Polls OpenSky Network for aircraft state vectors, persists snapshots and events to
MongoDB, and exposes REST API endpoints for the React frontend.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from starlette.middleware.cors import CORSMiddleware


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("flight-tracker")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
OPENSKY_USERNAME = os.environ.get("OPENSKY_USERNAME") or None
OPENSKY_PASSWORD = os.environ.get("OPENSKY_PASSWORD") or None
TRACKED_ICAO24 = os.environ.get("TRACKED_ICAO24", "a6616a").lower()
TRACKED_REGISTRATION = os.environ.get("TRACKED_REGISTRATION", "N51ZW")
DEFAULT_POLL_INTERVAL = int(os.environ.get("DEFAULT_POLL_INTERVAL", "300"))
SIGNAL_TIMEOUT_SECONDS = int(os.environ.get("SIGNAL_TIMEOUT_SECONDS", "600"))

OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"
OPENSKY_TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/"
    "protocol/openid-connect/token"
)


# ---------------------------------------------------------------------------
# MongoDB
# ---------------------------------------------------------------------------

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

snapshots_coll = db["flight_snapshots"]
events_coll = db["flight_events"]
settings_coll = db["flight_settings"]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class FlightSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    icao24: str
    callsign: Optional[str] = None
    origin_country: Optional[str] = None
    time_position: Optional[int] = None
    last_contact: Optional[int] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    baro_altitude: Optional[float] = None  # meters
    on_ground: Optional[bool] = None
    velocity: Optional[float] = None  # m/s
    true_track: Optional[float] = None  # degrees
    vertical_rate: Optional[float] = None  # m/s
    geo_altitude: Optional[float] = None
    squawk: Optional[str] = None
    spi: Optional[bool] = None
    position_source: Optional[int] = None
    opensky_time: Optional[int] = None
    derived_state: Optional[str] = None  # ON_GROUND | AIRBORNE | UNKNOWN | NO_SIGNAL
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class FlightEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    icao24: str
    event_type: str  # takeoff | landing | signal_lost | signal_available
    event_time: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    snapshot_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class SettingsModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = "singleton"
    poll_interval_seconds: int = DEFAULT_POLL_INTERVAL
    alert_takeoff: bool = True
    alert_landing: bool = True
    alert_signal_lost: bool = True
    alert_signal_available: bool = True
    sound_enabled: bool = True
    browser_notifications: bool = True


class SettingsUpdate(BaseModel):
    poll_interval_seconds: Optional[int] = None
    alert_takeoff: Optional[bool] = None
    alert_landing: Optional[bool] = None
    alert_signal_lost: Optional[bool] = None
    alert_signal_available: Optional[bool] = None
    sound_enabled: Optional[bool] = None
    browser_notifications: Optional[bool] = None


class AircraftStateResponse(BaseModel):
    icao24: str
    registration: str
    current_state: str
    last_snapshot: Optional[FlightSnapshot] = None
    last_event: Optional[FlightEvent] = None
    last_poll_at: Optional[str] = None
    last_poll_success: bool = False
    auth_mode: str = "anonymous"  # anonymous | basic | oauth


# ---------------------------------------------------------------------------
# OpenSky client (tries basic auth first, falls back to anonymous)
# ---------------------------------------------------------------------------

class OpenSkyClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(timeout=20.0)
        self.auth_mode = "anonymous"
        self.last_poll_at: Optional[str] = None
        self.last_poll_success: bool = False
        self._basic_auth_failed_count = 0

    async def close(self) -> None:
        await self._http.aclose()

    async def fetch_state(self, icao24: str) -> Optional[Dict[str, Any]]:
        self.last_poll_at = datetime.now(timezone.utc).isoformat()
        params = {"icao24": icao24.lower()}

        # Try basic auth if credentials provided and not repeatedly failed.
        auth = None
        if OPENSKY_USERNAME and OPENSKY_PASSWORD and self._basic_auth_failed_count < 3:
            auth = (OPENSKY_USERNAME, OPENSKY_PASSWORD)

        try:
            resp = await self._http.get(OPENSKY_STATES_URL, params=params, auth=auth)
        except httpx.HTTPError as exc:
            logger.warning("OpenSky request failed: %s", exc)
            self.last_poll_success = False
            return None

        # If auth rejected, retry anonymously and remember failure
        if auth is not None and resp.status_code in (401, 403):
            logger.warning(
                "OpenSky rejected basic auth (status %s) – retrying anonymous",
                resp.status_code,
            )
            self._basic_auth_failed_count += 1
            self.auth_mode = "anonymous"
            try:
                resp = await self._http.get(OPENSKY_STATES_URL, params=params)
            except httpx.HTTPError as exc:
                logger.warning("OpenSky anonymous retry failed: %s", exc)
                self.last_poll_success = False
                return None
        elif auth is not None and resp.status_code == 200:
            self.auth_mode = "basic"

        if resp.status_code == 429:
            logger.warning(
                "OpenSky rate limited; retry after %s",
                resp.headers.get("X-Rate-Limit-Retry-After-Seconds"),
            )
            self.last_poll_success = False
            return None

        if resp.status_code != 200:
            logger.warning("OpenSky returned status %s", resp.status_code)
            self.last_poll_success = False
            return None

        self.last_poll_success = True
        data = resp.json()
        states = data.get("states") or []
        if not states:
            return {"opensky_time": data.get("time"), "no_state": True}

        raw = states[0]
        return {
            "icao24": (raw[0] or "").lower(),
            "callsign": (raw[1] or "").strip() or None,
            "origin_country": raw[2],
            "time_position": raw[3],
            "last_contact": raw[4],
            "longitude": raw[5],
            "latitude": raw[6],
            "baro_altitude": raw[7],
            "on_ground": raw[8],
            "velocity": raw[9],
            "true_track": raw[10],
            "vertical_rate": raw[11],
            "geo_altitude": raw[13],
            "squawk": raw[14],
            "spi": raw[15],
            "position_source": raw[16],
            "opensky_time": data.get("time"),
            "no_state": False,
        }


opensky_client = OpenSkyClient()


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

def classify(snap: Optional[Dict[str, Any]]) -> str:
    if not snap or snap.get("no_state"):
        return "NO_DATA"
    if snap.get("on_ground") is True:
        return "ON_GROUND"
    alt = snap.get("geo_altitude") or snap.get("baro_altitude") or 0.0
    vel = snap.get("velocity") or 0.0
    if (alt or 0) > 50 and (vel or 0) > 20:
        return "AIRBORNE"
    if (alt or 0) < 30 and (vel or 0) < 10:
        return "ON_GROUND"
    return "UNKNOWN"


async def process_poll() -> None:
    """Called by APScheduler at the configured interval."""
    icao24 = TRACKED_ICAO24
    now = datetime.now(timezone.utc)

    data = await opensky_client.fetch_state(icao24)

    prev_doc = await snapshots_coll.find_one(
        {"icao24": icao24}, {"_id": 0}, sort=[("created_at", -1)]
    )
    previous_state = (prev_doc or {}).get("derived_state") or "UNKNOWN"

    new_state = classify(data) if data else "NO_DATA"

    # Persist snapshot if we have data with a state vector
    snapshot_id: Optional[str] = None
    if data and not data.get("no_state"):
        snap = FlightSnapshot(
            icao24=icao24,
            callsign=data.get("callsign"),
            origin_country=data.get("origin_country"),
            time_position=data.get("time_position"),
            last_contact=data.get("last_contact"),
            longitude=data.get("longitude"),
            latitude=data.get("latitude"),
            baro_altitude=data.get("baro_altitude"),
            on_ground=data.get("on_ground"),
            velocity=data.get("velocity"),
            true_track=data.get("true_track"),
            vertical_rate=data.get("vertical_rate"),
            geo_altitude=data.get("geo_altitude"),
            squawk=data.get("squawk"),
            spi=data.get("spi"),
            position_source=data.get("position_source"),
            opensky_time=data.get("opensky_time"),
            derived_state=new_state,
        )
        snap_doc = snap.model_dump()
        await snapshots_coll.insert_one(snap_doc)
        snapshot_id = snap.id

    # No state vector at all? Check signal timeout.
    if not data or data.get("no_state"):
        # If previous snapshot exists and was recent, treat as signal still tracked.
        if prev_doc and prev_doc.get("created_at"):
            try:
                last_dt = datetime.fromisoformat(prev_doc["created_at"])
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                age = (now - last_dt).total_seconds()
                if age > SIGNAL_TIMEOUT_SECONDS and previous_state != "NO_SIGNAL":
                    await emit_event(
                        icao24, "signal_lost", None,
                        {"age_seconds": int(age), "previous_state": previous_state},
                    )
                    # mark synthetic state in snapshots
                    marker = FlightSnapshot(
                        icao24=icao24, derived_state="NO_SIGNAL"
                    )
                    await snapshots_coll.insert_one(marker.model_dump())
            except (ValueError, TypeError):
                pass
        return

    # We have data. Detect transitions.
    if previous_state == "NO_SIGNAL" and new_state in ("ON_GROUND", "AIRBORNE"):
        await emit_event(
            icao24, "signal_available", snapshot_id, {"new_state": new_state}
        )

    if previous_state == "ON_GROUND" and new_state == "AIRBORNE":
        await emit_event(
            icao24, "takeoff", snapshot_id,
            {"from": previous_state, "to": new_state},
        )
    elif previous_state == "AIRBORNE" and new_state == "ON_GROUND":
        await emit_event(
            icao24, "landing", snapshot_id,
            {"from": previous_state, "to": new_state},
        )


async def emit_event(
    icao24: str,
    event_type: str,
    snapshot_id: Optional[str],
    details: Dict[str, Any],
) -> None:
    event = FlightEvent(
        icao24=icao24,
        event_type=event_type,
        snapshot_id=snapshot_id,
        details=details,
    )
    await events_coll.insert_one(event.model_dump())
    logger.info("Event emitted: %s for %s", event_type, icao24)


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

async def get_settings_doc() -> SettingsModel:
    doc = await settings_coll.find_one({"id": "singleton"}, {"_id": 0})
    if doc:
        return SettingsModel(**doc)
    settings = SettingsModel()
    await settings_coll.insert_one(settings.model_dump())
    return settings


async def update_settings(update: SettingsUpdate) -> SettingsModel:
    current = await get_settings_doc()
    new_data = current.model_dump()
    for k, v in update.model_dump(exclude_none=True).items():
        new_data[k] = v
    if "poll_interval_seconds" in new_data:
        new_data["poll_interval_seconds"] = max(
            10, min(int(new_data["poll_interval_seconds"]), 300)
        )
    await settings_coll.update_one(
        {"id": "singleton"}, {"$set": new_data}, upsert=True
    )
    return SettingsModel(**new_data)


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

scheduler = AsyncIOScheduler(timezone="UTC")


async def _safe_process() -> None:
    try:
        await process_poll()
    except Exception:  # noqa: BLE001
        logger.exception("Polling job failed")


def reschedule_job(interval_seconds: int) -> None:
    interval_seconds = max(10, min(int(interval_seconds), 300))
    if scheduler.get_job("poll_opensky"):
        scheduler.reschedule_job(
            "poll_opensky", trigger=IntervalTrigger(seconds=interval_seconds)
        )
    else:
        scheduler.add_job(
            _safe_process,
            IntervalTrigger(seconds=interval_seconds),
            id="poll_opensky",
            max_instances=1,
            coalesce=True,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=3),
        )


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = await get_settings_doc()
    # Ensure scheduler runs in current event loop
    if not scheduler.running:
        scheduler.start()
    reschedule_job(settings.poll_interval_seconds)
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)
    await opensky_client.close()
    mongo_client.close()


app = FastAPI(lifespan=lifespan)
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {
        "message": "N51ZW Flight Tracker API",
        "tracked": {"icao24": TRACKED_ICAO24, "registration": TRACKED_REGISTRATION},
    }


@api_router.get("/aircraft/state", response_model=AircraftStateResponse)
async def get_state():
    last_snap_doc = await snapshots_coll.find_one(
        {"icao24": TRACKED_ICAO24}, {"_id": 0}, sort=[("created_at", -1)]
    )
    last_event_doc = await events_coll.find_one(
        {"icao24": TRACKED_ICAO24}, {"_id": 0}, sort=[("event_time", -1)]
    )
    current = (last_snap_doc or {}).get("derived_state") or "UNKNOWN"
    return AircraftStateResponse(
        icao24=TRACKED_ICAO24,
        registration=TRACKED_REGISTRATION,
        current_state=current,
        last_snapshot=FlightSnapshot(**last_snap_doc) if last_snap_doc else None,
        last_event=FlightEvent(**last_event_doc) if last_event_doc else None,
        last_poll_at=opensky_client.last_poll_at,
        last_poll_success=opensky_client.last_poll_success,
        auth_mode=opensky_client.auth_mode,
    )


@api_router.get("/aircraft/events", response_model=List[FlightEvent])
async def list_events(limit: int = 100, since: Optional[str] = None):
    query: Dict[str, Any] = {"icao24": TRACKED_ICAO24}
    if since:
        query["event_time"] = {"$gt": since}
    cursor = events_coll.find(query, {"_id": 0}).sort("event_time", -1).limit(limit)
    return [FlightEvent(**doc) async for doc in cursor]


@api_router.get("/aircraft/history", response_model=List[FlightSnapshot])
async def list_history(limit: int = 200):
    cursor = (
        snapshots_coll.find(
            {"icao24": TRACKED_ICAO24, "longitude": {"$ne": None}}, {"_id": 0}
        )
        .sort("created_at", -1)
        .limit(limit)
    )
    docs = [FlightSnapshot(**d) async for d in cursor]
    return list(reversed(docs))


@api_router.get("/settings", response_model=SettingsModel)
async def read_settings():
    return await get_settings_doc()


@api_router.put("/settings", response_model=SettingsModel)
async def write_settings(update: SettingsUpdate):
    new_settings = await update_settings(update)
    if update.poll_interval_seconds is not None:
        reschedule_job(new_settings.poll_interval_seconds)
    return new_settings


@api_router.post("/aircraft/poll-now")
async def poll_now():
    """Trigger an immediate poll (useful for testing)."""
    await _safe_process()
    return {"ok": True, "polled_at": datetime.now(timezone.utc).isoformat()}


@api_router.post("/aircraft/test-event/{event_type}")
async def emit_test_event(event_type: str):
    """Emit a fake event for UI/notification testing."""
    if event_type not in ("takeoff", "landing", "signal_lost", "signal_available"):
        raise HTTPException(status_code=400, detail="invalid event type")
    await emit_event(
        TRACKED_ICAO24, event_type, None, {"test": True}
    )
    return {"ok": True, "event_type": event_type}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
