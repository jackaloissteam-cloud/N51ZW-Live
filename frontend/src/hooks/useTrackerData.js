import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  playAlarm,
  showBrowserNotification,
} from "@/lib/alarms";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const FRONTEND_POLL_MS = 8000; // poll backend every 8s for fresh state (cheap)

const eventCopy = {
  takeoff: {
    title: "🛫 N51ZW – Takeoff",
    body: "Mustang lifting off the ground.",
    pattern: "triple",
  },
  landing: {
    title: "🛬 N51ZW – Landung",
    body: "Mustang ist gelandet.",
    pattern: "double",
  },
  signal_lost: {
    title: "📡 N51ZW – Signal verloren",
    body: "Keine ADS-B Daten mehr empfangen.",
    pattern: "single",
  },
  signal_available: {
    title: "📡 N51ZW – Signal verfügbar",
    body: "ADS-B Daten wieder empfangen.",
    pattern: "double",
  },
};

export function useTrackerData() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastSeenEventIdRef = useRef(null);
  const settingsRef = useRef(null);
  settingsRef.current = settings;

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [s, h, e, st] = await Promise.all([
          axios.get(`${API}/aircraft/state`),
          axios.get(`${API}/aircraft/history?limit=200`),
          axios.get(`${API}/aircraft/events?limit=50`),
          axios.get(`${API}/settings`),
        ]);
        if (!mounted) return;
        setState(s.data);
        setHistory(h.data);
        setEvents(e.data);
        setSettings(st.data);
        if (e.data.length > 0) lastSeenEventIdRef.current = e.data[0].id;
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Failed to load");
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Polling for state + new events
  useEffect(() => {
    let aborted = false;
    let timer = null;

    const tick = async () => {
      if (aborted) return;
      try {
        const [s, e] = await Promise.all([
          axios.get(`${API}/aircraft/state`),
          axios.get(`${API}/aircraft/events?limit=50`),
        ]);
        if (aborted) return;
        setState(s.data);

        // Identify new events relative to last seen
        const newEvents = [];
        for (const ev of e.data) {
          if (ev.id === lastSeenEventIdRef.current) break;
          newEvents.push(ev);
        }
        if (newEvents.length > 0) {
          lastSeenEventIdRef.current = e.data[0].id;
          // alert in chronological order (oldest first)
          for (const ev of [...newEvents].reverse()) {
            triggerAlert(ev, settingsRef.current);
          }
        }
        setEvents(e.data);

        // Periodically refresh history (every 4th poll)
        if (Math.random() < 0.25) {
          const h = await axios.get(`${API}/aircraft/history?limit=200`);
          if (!aborted) setHistory(h.data);
        }
      } catch (err) {
        if (!aborted) console.warn("poll error", err);
      } finally {
        if (!aborted) timer = setTimeout(tick, FRONTEND_POLL_MS);
      }
    };

    timer = setTimeout(tick, FRONTEND_POLL_MS);
    return () => {
      aborted = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const saveSettings = async (patch) => {
    const { data } = await axios.put(`${API}/settings`, patch);
    setSettings(data);
    return data;
  };

  const pollNow = async () => {
    await axios.post(`${API}/aircraft/poll-now`);
    const [s, e] = await Promise.all([
      axios.get(`${API}/aircraft/state`),
      axios.get(`${API}/aircraft/events?limit=50`),
    ]);
    setState(s.data);
    setEvents(e.data);
    if (e.data.length > 0) lastSeenEventIdRef.current = e.data[0].id;
  };

  const testEvent = async (type) => {
    await axios.post(`${API}/aircraft/test-event/${type}`);
    // The next poll cycle will pick it up and alert.
  };

  return {
    state,
    history,
    events,
    settings,
    loading,
    error,
    saveSettings,
    pollNow,
    testEvent,
  };
}

function triggerAlert(ev, settings) {
  if (!settings) return;
  const flagMap = {
    takeoff: settings.alert_takeoff,
    landing: settings.alert_landing,
    signal_lost: settings.alert_signal_lost,
    signal_available: settings.alert_signal_available,
  };
  if (!flagMap[ev.event_type]) return;

  const copy = eventCopy[ev.event_type];
  if (!copy) return;

  toast(copy.title, { description: copy.body });

  if (settings.browser_notifications) {
    showBrowserNotification(copy.title, copy.body);
  }
  if (settings.sound_enabled) {
    playAlarm({ pattern: copy.pattern });
  }
}
