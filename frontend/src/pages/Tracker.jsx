import React from "react";
import AircraftProfile from "@/components/tracker/AircraftProfile";
import FlightDataCard from "@/components/tracker/FlightDataCard";
import AlertSettings from "@/components/tracker/AlertSettings";
import EventLog from "@/components/tracker/EventLog";
import AircraftMap from "@/components/tracker/AircraftMap";
import { useTrackerData } from "@/hooks/useTrackerData";

export default function Tracker() {
  const {
    state,
    history,
    events,
    settings,
    loading,
    error,
    saveSettings,
    pollNow,
    testEvent,
  } = useTrackerData();

  if (loading) {
    return (
      <div
        className="h-screen w-full flex items-center justify-center bg-[#0a0a0a] text-white grain"
        data-testid="loading-screen"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#007AFF] live-dot"></div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">
            Initializing tracker…
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="h-screen w-full flex items-center justify-center bg-[#0a0a0a] text-white"
        data-testid="error-screen"
      >
        <div className="max-w-sm text-center">
          <div className="text-red-400 font-bold mb-2">Connection Error</div>
          <div className="text-white/60 text-sm">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen w-full flex flex-col md:flex-row overflow-hidden bg-[#0a0a0a] text-white grain"
      data-testid="tracker-root"
    >
      {/* Sidebar */}
      <aside
        className="w-full md:w-[420px] h-full border-r border-white/10 bg-[#0a0a0a] flex flex-col z-10 overflow-y-auto custom-scrollbar"
        data-testid="sidebar"
      >
        <AircraftProfile state={state} />
        <FlightDataCard snapshot={state?.last_snapshot} />
        <AlertSettings
          settings={settings}
          onSave={saveSettings}
          onTestEvent={testEvent}
          onPollNow={pollNow}
        />
        <EventLog events={events} />
      </aside>

      {/* Map */}
      <main className="flex-1 h-[60vh] md:h-full relative z-0" data-testid="map-container">
        <AircraftMap snapshot={state?.last_snapshot} history={history} />
      </main>
    </div>
  );
}
