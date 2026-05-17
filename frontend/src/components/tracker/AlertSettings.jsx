import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { requestNotificationPermission, playAlarm } from "@/lib/alarms";

const INTERVAL_OPTIONS = [
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "2 min", value: 120 },
  { label: "5 min", value: 300 },
];

function Row({ label, description, children, testId }) {
  return (
    <div
      className="flex items-start justify-between gap-3 py-3 border-b border-white/5 last:border-b-0"
      data-testid={testId}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white">{label}</div>
        {description && (
          <div className="text-[11px] text-white/40 mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function AlertSettings({ settings, onSave, onTestEvent, onPollNow }) {
  const [saving, setSaving] = useState(false);

  if (!settings) return null;

  const update = async (patch) => {
    setSaving(true);
    try {
      await onSave(patch);
    } catch (e) {
      toast("Speichern fehlgeschlagen", { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationToggle = async (checked) => {
    if (checked) {
      const res = await requestNotificationPermission();
      if (res !== "granted") {
        toast("Benachrichtigungen blockiert", {
          description:
            "Bitte erlaube Browser-Benachrichtigungen in den Browsereinstellungen.",
        });
        return;
      }
    }
    update({ browser_notifications: checked });
  };

  return (
    <div className="px-6 py-5 border-b border-white/10" data-testid="alert-settings">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
          Alerts & Polling
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPollNow}
          className="h-7 px-2 text-[11px] text-[#007AFF] hover:text-[#3395FF] hover:bg-white/5"
          data-testid="poll-now-btn"
        >
          Poll now
        </Button>
      </div>

      {/* Polling interval */}
      <div className="py-3 border-b border-white/5" data-testid="row-interval">
        <div className="text-sm text-white mb-2">Polling-Intervall</div>
        <div className="flex flex-wrap gap-1.5">
          {INTERVAL_OPTIONS.map((opt) => {
            const active = settings.poll_interval_seconds === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => update({ poll_interval_seconds: opt.value })}
                disabled={saving}
                data-testid={`interval-${opt.value}`}
                className={`px-3 py-1.5 rounded-full text-[11px] tracker-mono border transition-colors ${
                  active
                    ? "bg-[#007AFF] text-white border-[#007AFF]"
                    : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-white/30 mt-2 tracker-mono">
          Aktuell: {settings.poll_interval_seconds}s
        </div>
      </div>

      <Row label="Start-Alarm" description="Bei Abheben benachrichtigen" testId="row-takeoff">
        <Switch
          checked={settings.alert_takeoff}
          onCheckedChange={(v) => update({ alert_takeoff: v })}
          data-testid="toggle-takeoff"
        />
      </Row>
      <Row label="Lande-Alarm" description="Bei Landung benachrichtigen" testId="row-landing">
        <Switch
          checked={settings.alert_landing}
          onCheckedChange={(v) => update({ alert_landing: v })}
          data-testid="toggle-landing"
        />
      </Row>
      <Row
        label="Signal verloren"
        description="Wenn ADS-B nicht mehr empfangen wird"
        testId="row-signal-lost"
      >
        <Switch
          checked={settings.alert_signal_lost}
          onCheckedChange={(v) => update({ alert_signal_lost: v })}
          data-testid="toggle-signal-lost"
        />
      </Row>
      <Row
        label="Signal verfügbar"
        description="Wenn ADS-B wieder online ist"
        testId="row-signal-available"
      >
        <Switch
          checked={settings.alert_signal_available}
          onCheckedChange={(v) => update({ alert_signal_available: v })}
          data-testid="toggle-signal-available"
        />
      </Row>
      <Row
        label="Browser-Benachrichtigung"
        description="Push außerhalb des Tabs"
        testId="row-browser"
      >
        <Switch
          checked={settings.browser_notifications}
          onCheckedChange={handleNotificationToggle}
          data-testid="toggle-browser-notifications"
        />
      </Row>
      <Row label="Sound" description="Akustischer Alarm-Ton" testId="row-sound">
        <Switch
          checked={settings.sound_enabled}
          onCheckedChange={(v) => {
            if (v) playAlarm({ pattern: "double" });
            update({ sound_enabled: v });
          }}
          data-testid="toggle-sound"
        />
      </Row>

      <div className="pt-4 mt-2 border-t border-white/5">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40 mb-2">
          Test
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {["takeoff", "landing", "signal_lost", "signal_available"].map((t) => (
            <button
              key={t}
              onClick={() => onTestEvent(t)}
              data-testid={`test-${t}`}
              className="px-2 py-1.5 rounded-md text-[10px] tracker-mono uppercase tracking-wider bg-white/5 hover:bg-white/10 text-white/70 border border-white/10"
            >
              {t.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
