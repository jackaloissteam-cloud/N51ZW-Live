/* Audio alarm utility – generates a short beep using Web Audio API. */

let audioCtx = null;

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function playAlarm({ pattern = "double", frequency = 880 } = {}) {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const playBeep = (start, duration = 0.18, freq = frequency) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(
      0.25,
      ctx.currentTime + start + 0.02
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + start + duration
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.05);
  };

  if (pattern === "single") {
    playBeep(0, 0.25, frequency);
  } else if (pattern === "triple") {
    playBeep(0, 0.15, frequency);
    playBeep(0.22, 0.15, frequency);
    playBeep(0.44, 0.25, frequency * 1.25);
  } else {
    // double
    playBeep(0, 0.18, frequency);
    playBeep(0.25, 0.22, frequency * 1.2);
  }
}

export function showBrowserNotification(title, body) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico", silent: false });
  } catch {
    /* noop */
  }
}

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
