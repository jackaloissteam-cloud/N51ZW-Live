"""
Backend tests for N51ZW Flight Tracker.
Covers:
- Root info endpoint
- Aircraft state / trail
- Events listing
- Settings GET / PUT with validation
- Test-event POST (each type + invalid)
- Poll-now endpoint
- ObjectId leak check across all responses
- CORS preflight
- APScheduler presence (via process behavior: poll-now must succeed without errors,
  and after PUT settings the in-app job is rescheduled — verified indirectly)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vintage-flight-hub.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

VALID_EVENT_TYPES = ["takeoff", "landing", "signal_lost", "signal_available"]


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _no_objectid(obj):
    """Recursively assert no '_id' keys exist in response payloads."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leaked in dict: keys={list(obj.keys())}"
        for v in obj.values():
            _no_objectid(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_objectid(v)


# --- Root --------------------------------------------------------------------
class TestRoot:
    def test_root_info(self, s):
        r = s.get(f"{API}/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("app") == "N51ZW Flight Tracker"
        assert data.get("icao24") == "a6616a"
        assert data.get("tail") == "N51ZW"
        _no_objectid(data)


# --- Aircraft state / trail --------------------------------------------------
class TestAircraft:
    def test_state_defaults(self, s):
        r = s.get(f"{API}/aircraft/state")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["icao24"] == "a6616a"
        assert d["tail_number"] == "N51ZW"
        assert d["aircraft_type"] == "P-51D Mustang"
        assert d["year"] == "1944"
        # has_signal must be a bool
        assert isinstance(d["has_signal"], bool)
        assert isinstance(d["in_flight"], bool)
        assert d["auth_mode"] in ("basic", "anonymous", "unknown")
        _no_objectid(d)

    def test_trail_is_list(self, s):
        r = s.get(f"{API}/aircraft/trail")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, list)
        _no_objectid(d)


# --- Events ------------------------------------------------------------------
class TestEvents:
    def test_events_list(self, s):
        r = s.get(f"{API}/events")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, list)
        _no_objectid(d)
        # validate sort newest-first if >=2 items
        if len(d) >= 2:
            assert d[0]["timestamp"] >= d[-1]["timestamp"]


# --- Settings ----------------------------------------------------------------
class TestSettings:
    def test_get_defaults(self, s):
        r = s.get(f"{API}/settings")
        assert r.status_code == 200, r.text
        d = r.json()
        # defaults (after possibly being mutated by previous runs, just type-check + key presence)
        for k in [
            "poll_interval_seconds", "alerts_takeoff", "alerts_landing",
            "alerts_signal_lost", "alerts_signal_available", "sound_enabled", "push_enabled",
        ]:
            assert k in d, f"missing key {k}"
        assert isinstance(d["poll_interval_seconds"], int)
        _no_objectid(d)

    def test_reject_too_small_interval(self, s):
        r = s.put(f"{API}/settings", json={"poll_interval_seconds": 5})
        assert r.status_code == 400, f"expected 400 for 5s, got {r.status_code}: {r.text}"

    def test_reject_too_large_interval(self, s):
        r = s.put(f"{API}/settings", json={"poll_interval_seconds": 999})
        assert r.status_code == 400, f"expected 400 for 999s, got {r.status_code}: {r.text}"

    @pytest.mark.parametrize("val", [30, 60, 300])
    def test_accept_valid_interval(self, s, val):
        r = s.put(f"{API}/settings", json={"poll_interval_seconds": val})
        assert r.status_code == 200, r.text
        assert r.json()["poll_interval_seconds"] == val
        # verify GET reflects the update (persistence)
        rg = s.get(f"{API}/settings")
        assert rg.json()["poll_interval_seconds"] == val

    @pytest.mark.parametrize("flag", [
        "alerts_takeoff", "alerts_landing", "alerts_signal_lost",
        "alerts_signal_available", "sound_enabled", "push_enabled",
    ])
    def test_toggle_flag(self, s, flag):
        # toggle off then on, verify with GET each time
        r1 = s.put(f"{API}/settings", json={flag: False})
        assert r1.status_code == 200, r1.text
        assert r1.json()[flag] is False
        g1 = s.get(f"{API}/settings").json()
        assert g1[flag] is False

        r2 = s.put(f"{API}/settings", json={flag: True})
        assert r2.status_code == 200
        assert r2.json()[flag] is True
        g2 = s.get(f"{API}/settings").json()
        assert g2[flag] is True

    def test_restore_default_interval(self, s):
        # restore to 300 so we don't leave noisy state for next run
        r = s.put(f"{API}/settings", json={"poll_interval_seconds": 300})
        assert r.status_code == 200


# --- Test-event endpoint -----------------------------------------------------
class TestTestEvent:
    @pytest.mark.parametrize("etype", VALID_EVENT_TYPES)
    def test_emit_each_type(self, s, etype):
        r = s.post(f"{API}/test-event", json={"type": etype})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == etype
        assert "id" in d and isinstance(d["id"], str) and len(d["id"]) > 0
        assert "timestamp" in d
        _no_objectid(d)

        # confirm it shows up in events list (newest first)
        ev = s.get(f"{API}/events?limit=20").json()
        assert any(e["id"] == d["id"] and e["type"] == etype for e in ev), \
            f"emitted {etype} event {d['id']} not found in /events"

    def test_invalid_type_rejected(self, s):
        r = s.post(f"{API}/test-event", json={"type": "bogus"})
        assert r.status_code == 422, f"expected 422 for invalid type, got {r.status_code}: {r.text}"


# --- Poll-now ----------------------------------------------------------------
class TestPollNow:
    def test_poll_now_returns_state(self, s):
        r = s.post(f"{API}/poll-now", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["icao24"] == "a6616a"
        assert d["tail_number"] == "N51ZW"
        # OPENSKY_PASSWORD is empty in .env -> auth_mode should be anonymous after a poll
        assert d["auth_mode"] in ("anonymous", "basic"), d["auth_mode"]
        # last_poll should be set after poll-now
        assert d["last_poll"] is not None
        _no_objectid(d)


# --- CORS --------------------------------------------------------------------
class TestCORS:
    def test_cors_preflight(self, s):
        r = s.options(
            f"{API}/aircraft/state",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        # FastAPI CORS middleware returns 200 for preflight
        assert r.status_code in (200, 204), r.text
        aco = r.headers.get("access-control-allow-origin")
        assert aco is not None, f"missing ACAO header. headers={dict(r.headers)}"

    def test_cors_simple_get(self, s):
        r = s.get(f"{API}/", headers={"Origin": "https://example.com"})
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") is not None


# --- Scheduler indirect check ------------------------------------------------
class TestSchedulerIndirect:
    def test_settings_update_triggers_reschedule(self, s):
        # Changing interval should hit the _schedule_job code path without 500
        r = s.put(f"{API}/settings", json={"poll_interval_seconds": 60})
        assert r.status_code == 200
        # poll-now should still work post-reschedule
        rp = s.post(f"{API}/poll-now", timeout=30)
        assert rp.status_code == 200
        # restore
        s.put(f"{API}/settings", json={"poll_interval_seconds": 300})
