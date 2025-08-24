import { VERSION } from "./constants.js";
import { onReady } from "./utils.js";
import { createUIElements, toggleSettingsModal, setManualSyncHandler } from "./ui.js";
import { registerMenuIntegration, invokeParseModal } from "./contextMenu.js";
import { setupCrossTabTimer } from "./crossTab.js";
import { runSyncFlow } from "./sync.js";

setManualSyncHandler(runSyncFlow);

onReady(() => {
  try {
    createUIElements();
    registerMenuIntegration();
    setupCrossTabTimer();

    // Allow external trigger (extension/content-script) to open parse modal with current selection
    window.addEventListener("message", (e) => {
      try {
        if (e?.data?.type === "SJTU_CAL_PARSE_SELECTED") {
          const sel = (window.getSelection()?.toString() || "").trim();
          invokeParseModal(sel);
        }
      } catch {}
    });

    // If running under an extension content script, support chrome.runtime messaging as well
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
          if (msg && msg.type === "SJTU_CAL_PARSE_SELECTED") {
            const sel = (window.getSelection()?.toString() || "").trim();
            invokeParseModal(sel);
            sendResponse && sendResponse({ ok: true });
          }
        });
      }
    } catch {}

    // 快捷键：Ctrl/Cmd + Shift + P 直接解析当前选择
    window.addEventListener("keydown", (e) => {
      const mod = navigator.platform.toUpperCase().includes("MAC") ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        const sel = (window.getSelection()?.toString() || "").trim();
        invokeParseModal(sel);
      }
    });

    // Keyboard shortcut: Ctrl/Cmd + Shift + R
    window.addEventListener("keydown", (e) => {
      const mod = navigator.platform.toUpperCase().includes("MAC") ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        toggleSettingsModal(true);
      }
    });

    // Tampermonkey menu
    try {
      if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("SJTU Radicale: 打开设置", () => toggleSettingsModal(true));
      }
    } catch {}

    console.log(`SJTU Radicale userscript loaded (v${VERSION})`);
  } catch (e) {
    console.error(e);
  }
});
