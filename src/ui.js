import { DEFAULTS, allowedPages } from "./constants.js";
import { storage } from "./storage.js";
import { escapeHTML } from "./utils.js";

const CSS = `
#sr-gear-btn{ position:fixed; right:18px; bottom:18px; z-index:2147483647; width:56px; height:56px; border-radius:14px; display:flex; align-items:center; justify-content:center; box-shadow:0 10px 30px rgba(11,116,222,0.18); backdrop-filter:blur(6px); cursor:pointer; background:linear-gradient(180deg,#0b74de,#0668c8);}
#sr-gear-btn .sr-gear { width:26px; height:26px; }
.sr-modal-backdrop{ position:fixed; inset:0; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; z-index:2147483646; }
.sr-panel{ width:760px; max-width:96%; max-height:88%; overflow:auto; border-radius:12px; background:linear-gradient(180deg,#ffffff,#fbfbff); box-shadow:0 20px 50px rgba(9,30,66,0.12); padding:20px; font-family:system-ui,Segoe UI,Roboto,'Helvetica Neue',Arial; }
.sr-panel h2{ margin:0 0 8px 0; font-size:18px; }
.sr-row{ display:flex; gap:12px; margin:8px 0; }
.sr-row label{ flex:1; display:flex; flex-direction:column; font-size:13px; color:#333; }
.sr-row input[type=text], .sr-row input[type=number], .sr-panel input[type=text]{ padding:8px 10px; border-radius:8px; border:1px solid #e6e9ef; }
.sr-actions{ display:flex; gap:10px; justify-content:flex-end; margin-top:14px; }
.sr-btn{ padding:8px 12px; border-radius:8px; border:none; cursor:pointer; }
.sr-btn.primary{ background:#0b74de; color:#fff; }
.sr-btn.ghost{ background:transparent; border:1px solid #e1e6f2; }
.sr-toast-root{ position:fixed; right:18px; bottom:86px; z-index:2147483647; display:flex; flex-direction:column; gap:10px; }
.sr-toast{ min-width:260px; max-width:420px; padding:10px 14px; border-radius:10px; box-shadow:0 10px 30px rgba(9,30,66,0.08); font-size:13px; transition:opacity 400ms; }
.sr-toast.info{ background:linear-gradient(180deg,#f8fbff,#f2f7ff); }
.sr-toast.error{ background:linear-gradient(180deg,#ffefef,#fff6f6); border:1px solid #ffd6d6; }
`;

let manualSyncHandler = null;
export function setManualSyncHandler(fn) { manualSyncHandler = fn; }

export function injectStyles() {
  if (document.getElementById("sr-styles")) return;
  const s = document.createElement("style");
  s.id = "sr-styles"; s.textContent = CSS;
  document.head.appendChild(s);
}

function isAllowedPage() {
  const currentUrl = location.hostname + location.pathname;
  return allowedPages.some(page => currentUrl.includes(page));
}

export function createUIElements() {
  // Ensure toast root exists on all pages
  injectStyles();
  if (!document.getElementById("sr-toast-root")) {
    const toastRoot = document.createElement("div");
    toastRoot.id = "sr-toast-root";
    toastRoot.className = "sr-toast-root";
    document.body.appendChild(toastRoot);
  }
  // Floating gear only on allowed pages
  if (!isAllowedPage()) return;
  if (document.getElementById("sr-gear-btn")) return;

  const btn = document.createElement("div");
  btn.id = "sr-gear-btn";
  btn.title = "打开 SJTU Radicale 同步设置 (Ctrl/Cmd+Shift+R)";
  btn.setAttribute("role","button");
  btn.setAttribute("aria-label","SJTU Radicale 设置");
  btn.innerHTML = `<svg class="sr-gear" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" fill="#fff"/><path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.7 7.7 0 0 0-1.7-.9l-.4-2.7A.5.5 0 0 0 13 2h-4a.5.5 0 0 0-.5.4l-.4 2.7c-.6.2-1.1.5-1.7.9l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.7L4.5 13a7.9 7.9 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.7l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7.9l.4 2.7c.05.2.23.4.5.4h4c.27 0 .45-.2.5-.4l.4-2.7c.6-.2 1.1-.5 1.7-.9l2.5 1c.24.1.5 0 .6-.2l2-3.5c.14-.24.07-.54-.1-.7L19.4 15z" fill="#fff"/></svg>`;
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggleSettingsModal(true); });
  document.body.appendChild(btn);
}

export function showToast(text, severity = "info", ttl = 6000) {
  const root = document.getElementById("sr-toast-root");
  if (!root) return;
  const t = document.createElement("div");
  t.className = "sr-toast " + (severity === "error" ? "error" : "info");
  t.innerHTML = `<div style="font-weight:600">${escapeHTML(text)}</div>`;
  root.appendChild(t);
  setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 450);
  }, ttl);
  if (severity !== "error") {
    storage.get("enableNotifications") && notifyNative(text);
  }
}

function notifyNative(text) {
  try {
    if (typeof GM_notification === "function") GM_notification({ title: "Radicale Sync", text, timeout: 3000 });
    else if ("Notification" in window) {
      if (Notification.permission === "granted") new Notification("Radicale Sync", { body: text });
      else if (Notification.permission !== "denied")
        Notification.requestPermission().then(p => { if (p === "granted") new Notification("Radicale Sync", { body: text }); });
    }
  } catch (e) { console.error(e); }
}

let modalOpen = false;
export function toggleSettingsModal(open) {
  if (open === modalOpen) return;
  modalOpen = open;
  if (open) buildSettingsModal();
  else {
    const m = document.querySelector(".sr-modal-backdrop");
    if (m) m.remove();
  }
}

async function buildSettingsModal() {
  const existing = document.querySelector(".sr-modal-backdrop"); if (existing) existing.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "sr-modal-backdrop";
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) toggleSettingsModal(false); });

  const panel = document.createElement("div");
  panel.className = "sr-panel";
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2>SJTU → Radicale 同步设置</h2>
      <div><button id="sr-close" class="sr-btn ghost">关闭</button></div>
    </div>
    <div class="sr-row">
      <label>Radicale Base URL<input id="rad-base" type="text" placeholder="http://127.0.0.1:5232"></label>
      <label>Radicale Username<input id="rad-user" type="text" placeholder="yourname"></label>
    </div>
    <label style="display:block;margin-top:6px">Optional Auth Header (e.g. Basic xxxx)<input id="rad-auth" type="text"></label>
    <div class="sr-row" style="margin-top:8px">
      <label>自动同步周期（分钟）<input id="auto-mins" type="number" min="1"></label>
      <label>日期窗口（天，前后）<input id="win-days" type="number" min="0"></label>
      <label style="display:flex;align-items:center;gap:8px">启用桌面通知<input id="enable-notif" type="checkbox" style="width:18px;height:18px"></label>
    </div>
    <hr style="border:none;border-top:1px solid #eef2ff;margin:12px 0">
    <h3 style="margin:0 0 6px 0">选中解析（右键） - 大模型解析</h3>
    <p style="margin:0 0 8px 0;color:#666;font-size:13px">配置解析服务类型与其参数。</p>
    <div class="sr-row">
      <label>解析服务类型
        <select id="llm-provider" style="padding:8px 10px;border-radius:8px;border:1px solid #e6e9ef;">
          <option value="zhipu_agent">智谱智能体</option>
        </select>
      </label>
    </div>
    <div id="llm-provider-config"></div>
    <div class="sr-actions">
      <button id="save-settings" class="sr-btn primary">保存并关闭</button>
      <button id="sync-now" class="sr-btn">立即同步</button>
    </div>
    <div style="margin-top:10px;color:#666;font-size:13px">最后同步: <span id="last-sync">n/a</span></div>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  // Fill values
  document.getElementById("rad-base").value = storage.get("radicalBase") || DEFAULTS.radicalBase;
  document.getElementById("rad-user").value = storage.get("radicalUsername") || DEFAULTS.radicalUsername;
  document.getElementById("rad-auth").value = storage.get("radicalAuth") || DEFAULTS.radicalAuth;
  document.getElementById("auto-mins").value = storage.get("autoSyncMinutes") || DEFAULTS.autoSyncMinutes;
  document.getElementById("win-days").value = storage.get("dateWindowDays") || DEFAULTS.dateWindowDays;
  document.getElementById("enable-notif").checked = !!storage.get("enableNotifications");
  const providerSelect = document.getElementById("llm-provider");
  providerSelect.value = storage.get("llmProvider") || "zhipu_agent";

  function renderLLMProviderConfig() {
    const prov = providerSelect.value;
    const wrap = document.getElementById("llm-provider-config");
    if (!wrap) return;
    if (prov === "zhipu_agent") {
      const currentUrl = storage.get("llmApiUrl") || "https://open.bigmodel.cn/api/llm-application/open/v3/application/invoke";
      const currentKey = storage.get("llmApiKey") || "";
      const currentAgent = storage.get("llmAgentId") || "1954810625930809344";
      wrap.innerHTML = `
        <div class="sr-row" style="margin-top:4px">
          <label>Agent ID (智谱智能体)<input id="llm-agent-id" type="text" placeholder="1954810625930809344" value="${escapeHTML(currentAgent)}"></label>
          <label>API URL<input id="llm-url" type="text" value="${escapeHTML(currentUrl)}"></label>
        </div>
        <label style="display:block;margin-top:6px">API Key / Token<input id="llm-key" type="text" value="${escapeHTML(currentKey)}"></label>
        <p style="margin:6px 0 0 0;font-size:12px;color:#777">将选中文本解析为事件：使用 智谱 智能体接口 (app_id=Agent ID)。</p>
      `;
    } else {
      wrap.innerHTML = `<p style="font-size:13px;color:#666">暂不支持该类型。</p>`;
    }
  }
  renderLLMProviderConfig();
  providerSelect.addEventListener("change", renderLLMProviderConfig);

  const last = storage.get("lastSync");
  document.getElementById("last-sync").textContent = last ? new Date(last).toLocaleString() : "n/a";

  document.getElementById("sr-close").addEventListener("click", () => toggleSettingsModal(false));
  document.getElementById("save-settings").addEventListener("click", () => {
    storage.set("radicalBase", document.getElementById("rad-base").value.trim());
    storage.set("radicalUsername", document.getElementById("rad-user").value.trim());
    storage.set("radicalAuth", document.getElementById("rad-auth").value.trim());
    storage.set("autoSyncMinutes", Number(document.getElementById("auto-mins").value) || DEFAULTS.autoSyncMinutes);
    storage.set("dateWindowDays", Number(document.getElementById("win-days").value) || DEFAULTS.dateWindowDays);
    storage.set("enableNotifications", document.getElementById("enable-notif").checked);
    const prov = providerSelect.value;
    storage.set("llmProvider", prov);
    if (prov === "zhipu_agent") {
      const agentId = (document.getElementById("llm-agent-id")?.value || "").trim();
      const apiUrl = (document.getElementById("llm-url")?.value || "").trim();
      const apiKey = (document.getElementById("llm-key")?.value || "").trim();
      storage.set("llmAgentId", agentId);
      storage.set("llmApiUrl", apiUrl);
      storage.set("llmApiKey", apiKey);
    }
    toggleSettingsModal(false);
    showToast("设置已保存");
  });

  document.getElementById("sync-now").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSettingsModal(false);
    showToast("开始手动同步...");
    if (typeof manualSyncHandler === "function") manualSyncHandler();
  });
}

// Add: generic text-input modal for LLM parsing
export function showTextInputModal({ title = "输入要解析的日程文本", initial = "", placeholder = "例如：明天下午3点-5点在创业大楼开产品评审会", onSubmit }) {
  injectStyles();
  const existing = document.getElementById("sr-input-modal");
  if (existing) existing.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "sr-modal-backdrop";
  backdrop.id = "sr-input-modal";

  const panel = document.createElement("div");
  panel.className = "sr-panel";
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2>${escapeHTML(title)}</h2>
      <div><button id="sr-input-close" class="sr-btn ghost">关闭</button></div>
    </div>
    <div>
      <textarea id="sr-input-text" rows="8" style="width:100%;resize:vertical;padding:10px;border-radius:10px;border:1px solid #e6e9ef;" placeholder="${escapeHTML(placeholder)}"></textarea>
    </div>
    <div class="sr-actions">
      <button id="sr-input-submit" class="sr-btn primary">解析并上传</button>
    </div>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const ta = panel.querySelector("#sr-input-text");
  ta.value = initial || "";

  // 新关闭按钮
  panel.querySelector("#sr-input-close").addEventListener("click", () => backdrop.remove());

  const submit = () => {
    const val = (ta.value || "").trim();
    if (!val) { showToast("请输入要解析的文本", "error"); return; }
    try { onSubmit && onSubmit(val); } finally { backdrop.remove(); } // 提交后仍自动关闭
  };
  panel.querySelector("#sr-input-submit").addEventListener("click", submit);
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "enter") submit();
    if (e.key === "Escape") backdrop.remove();
  });
}
