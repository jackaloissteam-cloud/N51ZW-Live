"""N51ZW Flight Tracker backend API tests."""

import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fall back to reading from frontend/.env
    from pathlib import Path
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")
API = f"{BASE_URL}/api"

TRACKED_ICAO24 = "a6616a"
TRACKED_REGISTRATION = "N51ZW"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Root ---
class TestRoot:
    def test_root_returns_tracker_info(self, client):
        r = client.get(f"{API}/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "message" in data
        assert data["tracked"]["icao24"] == TRACKED_ICAO24
        assert data["tracked"]["registration"] == TRACKED_REGISTRATION


# --- State ---
class TestState:
    def test_get_state_returns_required_fields(self, client):
        r = client.get(f"{API}/aircraft/state")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in (
            "icao24",
            "registration",
            "current_state",
            "last_poll_at",
            "last_poll_success",
            "auth_mode",
        ):
            assert k in data, f"missing field: {k}"
        assert data["icao24"] == TRACKED_ICAO24
        assert data["registration"] == TRACKED_REGISTRATION
        assert data["auth_mode"] in ("anonymous", "basic", "oauth")
        assert isinstance(data["last_poll_success"], bool)


# --- Events & History ---
class TestEventsHistory:
    def test_events_returns_list(self, client):
        r = client.get(f"{API}/aircraft/events")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_history_returns_list(self, client):
        r = client.get(f"{API}/aircraft/history")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


# --- Settings ---
class TestSettings:
    def test_get_settings_defaults(self, client):
        r = client.get(f"{API}/settings")
        assert r.status_code == 200, r.text
        data = r.json()
        # Defaults expected (after first GET should be persisted singleton)
        assert isinstance(data["poll_interval_seconds"], int)
        # default per env is 300; allow that it may have been changed by prior tests
        assert 10 <= data["poll_interval_seconds"] <= 600
        for k in (
            "alert_takeoff",
            "alert_landing",
            "alert_signal_lost",
            "alert_signal_available",
            "sound_enabled",
            "browser_notifications",
        ):
            assert k in data and isinstance(data[k], bool)

    def test_update_settings_and_persist(self, client):
        # Change to 30 and toggle a flag
        r = client.put(
            f"{API}/settings",
            json={"poll_interval_seconds": 30, "sound_enabled": False},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["poll_interval_seconds"] == 30
        assert data["sound_enabled"] is False

        # Verify GET reflects change
        r2 = client.get(f"{API}/settings")
        d2 = r2.json()
        assert d2["poll_interval_seconds"] == 30
        assert d2["sound_enabled"] is False

        # Restore defaults
        r3 = client.put(
            f"{API}/settings",
            json={"poll_interval_seconds": 300, "sound_enabled": True},
        )
        assert r3.status_code == 200
        assert r3.json()["poll_interval_seconds"] == 300
        assert r3.json()["sound_enabled"] is True

    def test_settings_clamp_lower(self, client):
        r = client.put(f"{API}/settings", json={"poll_interval_seconds": 5})
        assert r.status_code == 200, r.text
        assert r.json()["poll_interval_seconds"] == 10
        # restore
        client.put(f"{API}/settings", json={"poll_interval_seconds": 300})

    def test_settings_clamp_upper(self, client):
        r = client.put(f"{API}/settings", json={"poll_interval_seconds": 10000})
        assert r.status_code == 200, r.text
        # Backend clamps to 600 (per server.py max value)
        assert r.json()["poll_interval_seconds"] == 600
        # restore
        client.put(f"{API}/settings", json={"poll_interval_seconds": 300})


# --- Poll-now (real OpenSky integration) ---
class TestPollNow:
    def test_poll_now_succeeds(self, client):
        r = client.post(f"{API}/aircraft/poll-now", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert "polled_at" in data

        # After poll, state endpoint should reflect a last_poll_at
        s = client.get(f"{API}/aircraft/state").json()
        assert s["last_poll_at"] is not None
        # last_poll_success may be False if OpenSky transiently failed; auth_mode must be valid
        assert s["auth_mode"] in ("anonymous", "basic", "oauth")


# --- Test event emission ---
class TestEventEmission:
    @pytest.mark.parametrize(
        "event_type", ["takeoff", "landing", "signal_lost", "signal_available"]
    )
    def test_emit_each_event_and_verify(self, client, event_type):
        r = client.post(f"{API}/aircraft/test-event/{event_type}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["event_type"] == event_type

        # small wait for write
        time.sleep(0.3)

        # Verify shows up in events list
        ev = client.get(f"{API}/aircraft/events").json()
        assert any(
            e["event_type"] == event_type and e["icao24"] == TRACKED_ICAO24
            for e in ev
        ), f"event {event_type} not found in list"

    def test_invalid_event_type_returns_400(self, client):
        r = client.post(f"{API}/aircraft/test-event/bogus")
        assert r.status_code == 400, r.text
