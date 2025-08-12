import { BC_NAME, LOCK_KEY, DEFAULTS } from "./constants.js";
import { storage } from "./storage.js";
import { runSyncFlow } from "./sync.js";

async function tryAcquireAndRun() {
  const now = Date.now();
  const lock = localStorage.getItem(LOCK_KEY);
  if (lock) {
    try {
      const obj = JSON.parse(lock);
      if (now - obj.ts < 3 * 60 * 1000) {
        console.log("another tab is running sync");
        return;
      }
    } catch {}
  }
  localStorage.setItem(LOCK_KEY, JSON.stringify({ ts: now, id: Math.random().toString(36).slice(2) }));
  try {
    console.log("acquired lock, running sync");
    await runSyncFlow();
  } catch (err) {
    console.error("sync failed", err);
  } finally {
    localStorage.removeItem(LOCK_KEY);
  }
}

export function setupCrossTabTimer() {
  const bc = new BroadcastChannel(BC_NAME);
  bc.onmessage = async (ev) => {
    try {
      if (ev.data && ev.data.type === "request-sync") await tryAcquireAndRun();
    } catch (err) { console.error(err); }
  };

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("SJTU Radicale: 手动同步", () => {
      bc.postMessage({ type: "request-sync" });
    });
  }

  const mins = storage.get("autoSyncMinutes") || DEFAULTS.autoSyncMinutes;
  const ms = (mins || DEFAULTS.autoSyncMinutes) * 60 * 1000;
  setInterval(() => { bc.postMessage({ type: "request-sync" }); }, ms);

  if (location.hostname.includes("my.sjtu.edu.cn") && location.pathname.startsWith("/ui/calendar")) {
    setTimeout(() => { const bc2 = new BroadcastChannel(BC_NAME); bc2.postMessage({ type: "request-sync" }); }, 1600);
  }
}
