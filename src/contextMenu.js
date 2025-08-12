import { handleLLMParsingAndUpload } from "./llm.js";

export function setupContextMenu() {
  document.addEventListener("contextmenu", (e) => {
    const sel = window.getSelection().toString().trim();
    if (!sel) return;

    const existing = document.getElementById("sjtu-ctx-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    Object.assign(menu, { id: "sjtu-ctx-menu" });
    Object.assign(menu.style, {
      position: "absolute",
      left: `${e.pageX}px`,
      top: `${e.pageY}px`,
      zIndex: 2147483647,
      background: "#fff",
      border: "1px solid #e6e9ef",
      padding: "6px",
      borderRadius: "8px",
      boxShadow: "0 12px 30px rgba(9,30,66,0.12)"
    });

    const btn = document.createElement("button");
    btn.textContent = "解析并上传为日程";
    Object.assign(btn.style, {
      padding: "8px 10px",
      cursor: "pointer",
      background: "#0b74de",
      color: "#fff",
      border: "none",
      borderRadius: "6px"
    });
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      menu.remove();
      await handleLLMParsingAndUpload(sel);
    });

    menu.appendChild(btn);
    document.body.appendChild(menu);
    e.preventDefault();

    document.addEventListener("click", () => {
      const m = document.getElementById("sjtu-ctx-menu");
      if (m) m.remove();
    }, { once: true });
  });
}
