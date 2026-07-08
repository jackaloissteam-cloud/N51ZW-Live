"""
N51ZW Flight Tracker Backend
- Polls OpenSky Network for ICAO24 a6616a (P-51D Mustang N51ZW)
- State machine: takeoff / landing / signal_lost / signal_available
- Persists state + events to MongoDB
- Exposes REST API for the frontend
"""
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from pathlib import Path
from datetime import datetime, timezone
import os
import uuid
import logging
import httpx
import base64
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("n51zw")

# --- Config -----------------------------------------------------------------
ICAO24 = os.environ.get("AIRCRAFT_ICAO24", "a6616a").lower()
TAIL_NUMBER = os.environ.get("AIRCRAFT_TAIL", "N51ZW")
AIRCRAFT_TYPE = os.environ.get("AIRCRAFT_TYPE", "P-51D Mustang")
AIRCRAFT_YEAR = os.environ.get("AIRCRAFT_YEAR", "1944")

OPENSKY_USER = os.environ.get("OPENSKY_USERNAME", "").strip()
OPENSKY_PASS = os.environ.get("OPENSKY_PASSWORD", "").strip()
OPENSKY_CLIENT_ID = os.environ.get("OPENSKY_CLIENT_ID", "").strip()
OPENSKY_CLIENT_SECRET = os.environ.get("OPENSKY_CLIENT_SECRET", "").strip()
OPENSKY_URL = "https://opensky-network.org/api/states/all"
OPENSKY_TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"

TAKEOFF_SPEED_KNOTS = 40
GROUND_ALT_M = 100

# OAuth2 token cache (in-memory)
_oauth2_cache = {"token": None, "expires_at": 0.0}

# --- MongoDB ----------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# --- FastAPI ----------------------------------------------------------------
app = FastAPI(title="N51ZW Flight Tracker")
api = APIRouter(prefix="/api")


# --- Models -----------------------------------------------------------------
class AircraftState(BaseModel):
    icao24: str = ICAO24
    callsign: Optional[str] = None
    tail_number: str = TAIL_NUMBER
    aircraft_type: str = AIRCRAFT_TYPE
    year: str = AIRCRAFT_YEAR

    # live telemetry
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    baro_altitude: Optional[float] = None  # meters
    geo_altitude: Optional[float] = None
    velocity: Optional[float] = None  # m/s
    true_track: Optional[float] = None  # degrees 0=N
    vertical_rate: Optional[float] = None  # m/s
    on_ground: Optional[bool] = None
    origin_country: Optional[str] = None
    squawk: Optional[str] = None

    # status
    has_signal: bool = False
    in_flight: bool = False
    last_seen: Optional[str] = None  # ISO timestamp
    last_poll: Optional[str] = None
    last_position: Optional[str] = None

    # auth mode used for last poll
    auth_mode: Literal["oauth2", "basic", "anonymous", "unknown"] = "unknown"


class FlightEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["takeoff", "landing", "signal_lost", "signal_available"]
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    velocity: Optional[float] = None
    note: Optional[str] = None


class Settings(BaseModel):
    poll_interval_seconds: int = 300  # default 5 min
    alerts_takeoff: bool = True
    alerts_landing: bool = True
    alerts_signal_lost: bool = True
    alerts_signal_available: bool = True
    sound_enabled: bool = True
    push_enabled: bool = True


class SettingsUpdate(BaseModel):
    poll_interval_seconds: Optional[int] = None
    alerts_takeoff: Optional[bool] = None
    alerts_landing: Optional[bool] = None
    alerts_signal_lost: Optional[bool] = None
    alerts_signal_available: Optional[bool] = None
    sound_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None


class TestEventRequest(BaseModel):
    type: Literal["takeoff", "landing", "signal_lost", "signal_available"]


# --- In-memory current state (refreshed by scheduler) -----------------------
current_state = AircraftState()


# --- DB helpers -------------------------------------------------------------
async def get_settings() -> Settings:
    doc = await db.settings.find_one({"_id": "global"}, {"_id": 0})
    if not doc:
        s = Settings()
        await db.settings.update_one({"_id": "global"}, {"$set": s.model_dump()}, upsert=True)
        return s
    return Settings(**doc)


async def save_settings(s: Settings):
    await db.settings.update_one({"_id": "global"}, {"$set": s.model_dump()}, upsert=True)


async def insert_event(ev: FlightEvent):
    await db.events.insert_one(ev.model_dump())
    logger.info(f"📡 EVENT: {ev.type} @ ({ev.latitude},{ev.longitude}) alt={ev.altitude}")


async def list_events(limit: int = 50) -> List[FlightEvent]:
    cur = db.events.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit)
    items = await cur.to_list(length=limit)
    return [FlightEvent(**i) for i in items]


# --- OpenSky polling --------------------------------------------------------
async def _get_oauth2_token() -> Optional[str]:
    """Fetch or reuse cached OAuth2 client_credentials access token."""
    import time
    now = time.time()
    # reuse cached token if still valid (with 30s safety margin)
    if _oauth2_cache["token"] and _oauth2_cache["expires_at"] - 30 > now:
        return _oauth2_cache["token"]
    if not (OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET):
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.post(
                OPENSKY_TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": OPENSKY_CLIENT_ID,
                    "client_secret": OPENSKY_CLIENT_SECRET,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if r.status_code != 200:
            logger.warning(f"OpenSky OAuth2 token fetch failed: HTTP {r.status_code} · {r.text[:200]}")
            return None
        payload = r.json()
        token = payload.get("access_token")
        expires_in = int(payload.get("expires_in") or 1800)
        _oauth2_cache["token"] = token
        _oauth2_cache["expires_at"] = now + expires_in
        logger.info(f"🔐 OpenSky OAuth2 token acquired (expires in {expires_in}s)")
        return token
    except Exception as e:
        logger.error(f"OAuth2 token request error: {e}")
        return None


async def fetch_opensky() -> tuple[Optional[dict], str]:
    """Returns (state_dict_or_none, auth_mode). Tries OAuth2 → Basic → Anonymous."""
    params = {"icao24": ICAO24}
    headers = {"User-Agent": "n51zw-tracker/1.0"}
    auth_mode = "anonymous"

    # 1) Try OAuth2 client_credentials
    if OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET:
        token = await _get_oauth2_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
            auth_mode = "oauth2"

    # 2) Fallback to Basic auth
    if auth_mode == "anonymous" and OPENSKY_USER and OPENSKY_PASS:
        token_b64 = base64.b64encode(f"{OPENSKY_USER}:{OPENSKY_PASS}".encode()).decode()
        headers["Authorization"] = f"Basic {token_b64}"
        auth_mode = "basic"

    try:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            r = await cli.get(OPENSKY_URL, params=params, headers=headers)
        # If auth-mode fails, cascade to anonymous
        if r.status_code == 401 and auth_mode in ("oauth2", "basic"):
            logger.warning(f"OpenSky {auth_mode} failed (401) → falling back to anonymous")
            # invalidate token cache on 401
            if auth_mode == "oauth2":
                _oauth2_cache["token"] = None
                _oauth2_cache["expires_at"] = 0.0
            async with httpx.AsyncClient(timeout=15.0) as cli:
                r = await cli.get(OPENSKY_URL, params=params, headers={"User-Agent": "n51zw-tracker/1.0"})
            auth_mode = "anonymous"
        r.raise_for_status()
        data = r.json()
        states = data.get("states") or []
        if not states:
            return None, auth_mode
        row = states[0]
        return {
            "icao24": row[0],
            "callsign": (row[1] or "").strip() or None,
            "origin_country": row[2],
            "time_position": row[3],
            "last_contact": row[4],
            "longitude": row[5],
            "latitude": row[6],
            "baro_altitude": row[7],
            "on_ground": row[8],
            "velocity": row[9],
            "true_track": row[10],
            "vertical_rate": row[11],
            "geo_altitude": row[13],
            "squawk": row[14],
        }, auth_mode
    except Exception as e:
        logger.error(f"OpenSky poll failed: {e}")
        return None, auth_mode


def _derive_in_flight(s: dict) -> bool:
    """Heuristic: in flight if on_ground=False OR (velocity > threshold AND baro_altitude > ground)."""
    if s.get("on_ground") is False:
        return True
    vel = s.get("velocity")
    alt = s.get("baro_altitude")
    if vel is not None and vel * 1.9438 > TAKEOFF_SPEED_KNOTS:
        if alt is None or alt > GROUND_ALT_M:
            return True
    return False


async def poll_once():
    global current_state
    logger.info(f"⏱️  Polling OpenSky for {ICAO24}…")
    raw, auth_mode = await fetch_opensky()
    now_iso = datetime.now(timezone.utc).isoformat()

    prev_signal = current_state.has_signal
    prev_in_flight = current_state.in_flight

    if raw is None:
        # no signal
        new_state = AircraftState(
            **{**current_state.model_dump(), "has_signal": False, "in_flight": False,
               "last_poll": now_iso, "auth_mode": auth_mode}
        )
        # event: signal_lost (only if we had signal before)
        if prev_signal:
            await insert_event(FlightEvent(
                type="signal_lost",
                latitude=current_state.latitude,
                longitude=current_state.longitude,
                altitude=current_state.baro_altitude,
                velocity=current_state.velocity,
                note=f"Signal verloren · letzte Position {current_state.last_position or 'unbekannt'}",
            ))
        current_state = new_state
    else:
        in_flight = _derive_in_flight(raw)
        new_state = AircraftState(
            icao24=raw["icao24"] or ICAO24,
            callsign=raw["callsign"],
            tail_number=TAIL_NUMBER,
            aircraft_type=AIRCRAFT_TYPE,
            year=AIRCRAFT_YEAR,
            latitude=raw["latitude"],
            longitude=raw["longitude"],
            baro_altitude=raw["baro_altitude"],
            geo_altitude=raw["geo_altitude"],
            velocity=raw["velocity"],
            true_track=raw["true_track"],
            vertical_rate=raw["vertical_rate"],
            on_ground=raw["on_ground"],
            origin_country=raw["origin_country"],
            squawk=raw["squawk"],
            has_signal=True,
            in_flight=in_flight,
            last_seen=now_iso,
            last_poll=now_iso,
            last_position=(
                f"{raw['latitude']:.4f}, {raw['longitude']:.4f}"
                if raw.get("latitude") is not None and raw.get("longitude") is not None
                else current_state.last_position
            ),
            auth_mode=auth_mode,
        )

        # signal_available event (signal re-acquired)
        if not prev_signal:
            await insert_event(FlightEvent(
                type="signal_available",
                latitude=new_state.latitude,
                longitude=new_state.longitude,
                altitude=new_state.baro_altitude,
                velocity=new_state.velocity,
                note=f"Signal wieder da · Callsign {new_state.callsign or '—'}",
            ))
        # takeoff event
        if not prev_in_flight and in_flight:
            await insert_event(FlightEvent(
                type="takeoff",
                latitude=new_state.latitude,
                longitude=new_state.longitude,
                altitude=new_state.baro_altitude,
                velocity=new_state.velocity,
                note="Mustang ist in der Luft 🛫",
            ))
        # landing event
        if prev_in_flight and not in_flight:
            await insert_event(FlightEvent(
                type="landing",
                latitude=new_state.latitude,
                longitude=new_state.longitude,
                altitude=new_state.baro_altitude,
                velocity=new_state.velocity,
                note="Mustang gelandet 🛬",
            ))

        current_state = new_state

    # persist latest state snapshot
    await db.state.update_one({"_id": "current"}, {"$set": current_state.model_dump()}, upsert=True)
    # also append trail point if we have lat/lon and in_flight
    if current_state.has_signal and current_state.latitude and current_state.longitude:
        await db.trail.insert_one({
            "ts": now_iso,
            "lat": current_state.latitude,
            "lon": current_state.longitude,
            "alt": current_state.baro_altitude,
            "track": current_state.true_track,
            "velocity": current_state.velocity,
        })


# --- Scheduler --------------------------------------------------------------
scheduler = AsyncIOScheduler()
_current_job_id = "opensky_poll"


def _schedule_job(interval_seconds: int):
    if scheduler.get_job(_current_job_id):
        scheduler.remove_job(_current_job_id)
    scheduler.add_job(poll_once, "interval", seconds=interval_seconds, id=_current_job_id, max_instances=1, coalesce=True)
    logger.info(f"🛰️  Scheduler armed: every {interval_seconds}s")


@app.on_event("startup")
async def on_startup():
    # load last state
    last = await db.state.find_one({"_id": "current"}, {"_id": 0})
    if last:
        global current_state
        try:
            current_state = AircraftState(**last)
        except Exception:
            pass
    s = await get_settings()
    scheduler.start()
    _schedule_job(s.poll_interval_seconds)
    # kick off first poll immediately (non-blocking)
    asyncio.create_task(poll_once())


@app.on_event("shutdown")
async def on_shutdown():
    if scheduler.running:
        scheduler.shutdown(wait=False)
    client.close()


# --- API --------------------------------------------------------------------
@api.get("/")
async def root():
    return {"app": "N51ZW Flight Tracker", "icao24": ICAO24, "tail": TAIL_NUMBER}


@api.get("/aircraft/state", response_model=AircraftState)
async def get_state():
    return current_state


@api.get("/aircraft/trail")
async def get_trail(limit: int = 200):
    cur = db.trail.find({}, {"_id": 0}).sort("ts", -1).limit(limit)
    items = await cur.to_list(length=limit)
    items.reverse()  # chronological order for line drawing
    return items


@api.get("/events", response_model=List[FlightEvent])
async def get_events(limit: int = 50):
    return await list_events(limit)


@api.get("/settings", response_model=Settings)
async def read_settings():
    return await get_settings()


@api.put("/settings", response_model=Settings)
async def update_settings(payload: SettingsUpdate):
    current = await get_settings()
    updated = current.model_copy(update={k: v for k, v in payload.model_dump().items() if v is not None})
    if updated.poll_interval_seconds < 10 or updated.poll_interval_seconds > 600:
        raise HTTPException(status_code=400, detail="poll_interval_seconds must be 10..600")
    await save_settings(updated)
    if updated.poll_interval_seconds != current.poll_interval_seconds:
        _schedule_job(updated.poll_interval_seconds)
    return updated


@api.post("/test-event", response_model=FlightEvent)
async def test_event(payload: TestEventRequest):
    """Emit a synthetic event for UI testing of alerts."""
    ev = FlightEvent(
        type=payload.type,
        latitude=current_state.latitude,
        longitude=current_state.longitude,
        altitude=current_state.baro_altitude,
        velocity=current_state.velocity,
        note=f"TEST · {payload.type}",
    )
    await insert_event(ev)
    return ev


@api.post("/poll-now", response_model=AircraftState)
async def poll_now():
    """Trigger an immediate poll cycle (for the UI 'refresh' button)."""
    await poll_once()
    return current_state


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
