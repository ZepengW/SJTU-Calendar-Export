import { VERSION } from "./constants.js";
import { onReady } from "./utils.js";
import { createUIElements, toggleSettingsModal, setManualSyncHandler } from "./ui.js";
import { setupContextMenu } from "./contextMenu.js";
import { setupCrossTabTimer } from "./crossTab.js";
import { runSyncFlow } from "./sync.js";

setManualSyncHandler(runSyncFlow);

onReady(() => {
  try {
    createUIElements();
    setupContextMenu();
    setupCrossTabTimer();

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
