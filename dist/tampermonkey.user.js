// ==UserScript==
// @name         SJTU Calendar → Radicale Sync (Tampermonkey)
// @namespace    https://github.com/ZepengW/SJTU-Calendar-Export
// @version      1.0
// @description  从 my.sjtu.edu.cn 自动抓取日程并生成 ICS 上传到 Radicale；支持选中文本调用大模型解析为日程并上传。带设置 UI 与跨页定时/单次触发（只触发一次）。
// @author       自动生成
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @connect      calendar.sjtu.edu.cn
// @connect      *
// ==/UserScript==
(function () {
  'use strict';

  const VERSION = "1.0";

  const DEFAULTS = {
    radicalBase: "http://127.0.0.1:5232",
    radicalUsername: "user",
    radicalAuth: "",
    autoSyncMinutes: 60,
    dateWindowDays: 14,
    enableNotifications: true,
    lastSync: null,
    llmApiUrl: "",
    llmApiKey: ""
  };

  const allowedPages = [
    "my.sjtu.edu.cn/ui/calendar",
    "example.com/specific-page"
  ];

  const BC_NAME = "sjtu-radicale-sync-channel";
  const LOCK_KEY = "sjtu-radicale-sync-lock";

  function formatDateForAPI(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}+00:00`;
  }

  function isoToICSTime(dt) {
    const s = dt.toISOString();
    return s.replace(/[-:.]/g, "").slice(0, 15) + "Z";
  }

  function parseSJTUTime(s) {
    const m = s && s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  }

  function parseLLMTime(s) {
    if (!s) return null;
    const match = s.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})/);
    if (!match) return null;
    const [_, y, m, d, H, M, S, tz] = match;
    return new Date(`${y}-${m}-${d}T${H}:${M}:${S}${tz}`);
  }

  function escapeICSText(s) {
    if (!s) return "";
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/, /g, ",")
      .replace(/;/g, "\\;");
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(fn, 60);
    else document.addEventListener("DOMContentLoaded", fn);
  }

  const storage = {
    get(key) {
      try {
        return typeof GM_getValue === "function"
          ? GM_getValue(key, DEFAULTS[key])
          : JSON.parse(localStorage.getItem(key)) ?? DEFAULTS[key];
      } catch {
        return DEFAULTS[key];
      }
    },
    set(key, val) {
      try {
        if (typeof GM_setValue === "function") return GM_setValue(key, val);
        localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        console.error(e);
      }
    },
    del(key) {
      try {
        if (typeof GM_deleteValue === "function") return GM_deleteValue(key);
        localStorage.removeItem(key);
      } catch (e) {
        console.error(e);
      }
    }
  };

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
  function setManualSyncHandler(fn) { manualSyncHandler = fn; }

  function injectStyles() {
    if (document.getElementById("sr-styles")) return;
    const s = document.createElement("style");
    s.id = "sr-styles"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function isAllowedPage() {
    const currentUrl = location.hostname + location.pathname;
    return allowedPages.some(page => currentUrl.includes(page));
  }

  function createUIElements() {
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

  function showToast(text, severity = "info", ttl = 6000) {
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
  function toggleSettingsModal(open) {
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
  function showTextInputModal({ title = "输入要解析的日程文本", initial = "", placeholder = "例如：明天下午3点-5点在创业大楼开产品评审会", onSubmit }) {
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

  function gmHttp(opts) {
    return new Promise((resolve, reject) => {
      const gm = typeof GM_xmlhttpRequest !== "undefined"
        ? GM_xmlhttpRequest
        : (window.GM && window.GM.xmlHttpRequest);
      if (!gm) {
        fetch(opts.url, {
          method: opts.method || "GET",
          headers: opts.headers || {},
          body: opts.data || undefined
        })
          .then(async (r) => {
            const text = await r.text();
            resolve({ status: r.status, responseText: text, finalUrl: r.url, ok: r.ok });
          })
          .catch(reject);
        return;
      }
      gm({
        method: opts.method || "GET",
        url: opts.url,
        headers: opts.headers || {},
        data: opts.data || undefined,
        responseType: opts.responseType || "text",
        onload(resp) {
          resolve({
            status: resp.status,
            responseText: resp.responseText,
            finalUrl: resp.finalUrl || opts.url,
            ok: resp.status >= 200 && resp.status < 300
          });
        },
        onerror(err) { reject(err); },
        ontimeout() { reject(new Error("timeout")); }
      });
    });
  }

  async function getProfile() {
    const url = "https://calendar.sjtu.edu.cn/api/share/profile";
    const resp = await gmHttp({ url, method: "GET" });
    if (!resp.ok) throw new Error(`profile fetch status ${resp.status}`);
    return JSON.parse(resp.responseText);
  }

  async function getEventsWindow(days = 14) {
    const now = new Date();
    const start = new Date(now.getTime()); start.setDate(now.getDate() - days);
    const end = new Date(now.getTime()); end.setDate(now.getDate() + days);
    const url = `https://calendar.sjtu.edu.cn/api/event/list?startDate=${formatDateForAPI(start)}&endDate=${formatDateForAPI(end)}&weekly=false&ids=`;
    const resp = await gmHttp({ url, method: "GET" });
    if (!resp.ok) throw new Error(`events fetch status ${resp.status}`);
    return JSON.parse(resp.responseText);
  }

  function buildICS(events, calendarName = "SJTU") {
    const now = new Date();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SJTU-Radicale-Sync//EN",
      `X-WR-CALNAME:${escapeICSText(calendarName)}`,
      `X-WR-TIMEZONE:UTC`
    ];
    for (const ev of events) {
      try {
        if (!ev.startTime || !ev.endTime || !ev.title) continue;
        lines.push("BEGIN:VEVENT");
        const uid = ev.eventId || ev.id || "evt-" + Math.random().toString(36).slice(2);
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${isoToICSTime(now)}`);
        const s = ev.startTime instanceof Date ? ev.startTime : parseSJTUTime(ev.startTime);
        const e = ev.endTime instanceof Date ? ev.endTime : parseSJTUTime(ev.endTime);
        if (!s || !e) continue;
        lines.push(`DTSTART:${isoToICSTime(s)}`);
        lines.push(`DTEND:${isoToICSTime(e)}`);
        lines.push(`SUMMARY:${escapeICSText(ev.title || ev.summary || "")}`);
        if (ev.location) lines.push(`LOCATION:${escapeICSText(ev.location)}`);
        if (ev.status) lines.push(`STATUS:${escapeICSText(ev.status)}`);
        lines.push(`DESCRIPTION:${escapeICSText(JSON.stringify(ev))}`);
        lines.push("END:VEVENT");
      } catch (err) {
        console.error("buildICS: event failed", ev, err);
      }
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function parseICSEventsByUID(icsText) {
    const map = new Map();
    if (!icsText || typeof icsText !== "string") return map;
    // unfold folded lines per RFC 5545: lines beginning with space/tab are continuations
    const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);

    let inEvent = false;
    let buf = [];
    let uid = null;

    for (const line of lines) {
      if (line === "BEGIN:VEVENT") {
        inEvent = true;
        buf = ["BEGIN:VEVENT"];
        uid = null;
        continue;
      }
      if (line === "END:VEVENT") {
        buf.push("END:VEVENT");
        if (uid) {
          map.set(uid, buf.join("\r\n"));
        }
        inEvent = false;
        buf = [];
        uid = null;
        continue;
      }
      if (inEvent) {
        buf.push(line);
        if (!uid && /^UID[:;]/i.test(line)) {
          const idx = line.indexOf(":");
          if (idx >= 0) uid = line.slice(idx + 1).trim();
        }
      }
    }
    return map;
  }

  function mergeICSByUID(existingICS, newICS, calendarName = "SJTU") {
    const oldMap = parseICSEventsByUID(existingICS);
    const newMap = parseICSEventsByUID(newICS);
    for (const [uid, block] of newMap.entries()) {
      oldMap.set(uid, block); // new overwrites old on same UID
    }

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SJTU-Radicale-Sync//EN",
      `X-WR-CALNAME:${escapeICSText(calendarName)}`,
      "X-WR-TIMEZONE:UTC"
    ];
    // stable order by UID for deterministic output
    for (const [, block] of Array.from(oldMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(block);
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  async function uploadToRadicale(ics, calendarName = "SJTU") {
    const base = storage.get("radicalBase") || DEFAULTS.radicalBase;
    const user = storage.get("radicalUsername") || DEFAULTS.radicalUsername;
    const auth = storage.get("radicalAuth") || "";
    const baseUrl = base.replace(/\/$/, "");
    const url = `${baseUrl}/${encodeURIComponent(user)}/${encodeURIComponent(calendarName)}.ics`;
    const headers = { "Content-Type": "text/calendar; charset=utf-8" };
    if (auth) headers["Authorization"] = auth;

    // Try incremental: fetch existing ICS, merge by UID, then PUT
    let finalIcs = ics;
    try {
      const getHeaders = {};
      if (auth) getHeaders["Authorization"] = auth;
      const getResp = await gmHttp({ url, method: "GET", headers: getHeaders });
      if (getResp.status === 200 && typeof getResp.responseText === "string" && getResp.responseText.startsWith("BEGIN:VCALENDAR")) {
        finalIcs = mergeICSByUID(getResp.responseText, ics, calendarName);
      } else if (getResp.status === 404) {
        // no existing file, keep finalIcs = ics
      } else if (!getResp.ok) {
        console.warn("GET existing ICS failed, fallback to full upload:", getResp.status);
      }
    } catch (e) {
      console.warn("GET existing ICS threw, fallback to full upload:", e);
    }

    const resp = await gmHttp({ url, method: "PUT", headers, data: finalIcs });
    if (resp.status === 200 || resp.status === 201 || resp.status === 204) {
      storage.set("lastSync", Date.now());
      showToast(`同步成功: ${url}`);
      return { ok: true, url };
    }
    if (resp.status === 401 || resp.status === 403) throw new Error("鉴权失败（401/403）");
    throw new Error(`上传失败，HTTP ${resp.status} ${resp.responseText || ""}`);
  }

  async function runSyncFlow() {
    const profile = await getProfile().catch(err => { throw new Error("无法获取登录信息: " + (err.message || err)); });
    if (!profile || !profile.success || !profile.data || !profile.data.account) {
      showToast("未登录或无法获取账号信息", "error");
      return;
    }
    const account = profile.data.account;
    const eventsResp = await getEventsWindow(storage.get("dateWindowDays") || DEFAULTS.dateWindowDays);
    if (!eventsResp || !eventsResp.success) throw new Error("获取日程返回异常");
    const events = (eventsResp.data && eventsResp.data.events) || [];
    const calName = `SJTU-${account}`;
    const ics = buildICS(events, calName);
    const res = await uploadToRadicale(ics, calName);
    if (res && res.ok) showToast("上传到 Radicale: " + res.url);
  }

  async function parseSelectedTextWithLLM(text) {
    const configuredUrl = storage.get("llmApiUrl");
    const url = configuredUrl && configuredUrl.trim()
      ? configuredUrl.trim()
      : "https://open.bigmodel.cn/api/llm-application/open/v3/application/invoke";
    const key = storage.get("llmApiKey") || "";
    if (!key) {
      showToast("未配置 LLM API Key", "error");
      throw new Error("未配置 LLM API Key");
    }

    const provider = storage.get("llmProvider") || "zhipu_agent";
    let agentId;
    switch (provider) {
      case "zhipu_agent":
        agentId = storage.get("llmAgentId") || "1954810625930809344";
        if (!agentId) {
          showToast("未配置 Agent ID", "error");
          throw new Error("未配置 Agent ID");
        }
        break;
      default:
        showToast("不支持的解析服务类型: " + provider, "error");
        throw new Error("不支持的解析服务类型");
    }

    const now = new Date();
    const todayDate = now.toISOString().split("T")[0];
    const currentTime = now.toTimeString().split(" ")[0];

    const headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
    const body = JSON.stringify({
      app_id: agentId,
      messages: [
        { role: "user", content: [{ type: "input", value: `今天的日期是 ${todayDate}，当前时间是 ${currentTime}。\n\n请解析以下文本为日程:\n${text}` }] }
      ],
      stream: false
    });

    showToast("调用大模型解析文本中...", "info");
    const resp = await gmHttp({ url, method: "POST", headers, data: body });
    if (!resp.ok) {
      showToast(`LLM 请求失败: HTTP ${resp.status}`, "error");
      throw new Error("LLM 请求失败: " + resp.status);
    }

    let responseJson;
    try { responseJson = JSON.parse(resp.responseText); }
    catch (e) {
      showToast("无法解析大模型返回内容", "error");
      throw new Error("无法解析大模型返回内容: " + e.message);
    }

    const content = responseJson.choices?.[0]?.messages?.content?.msg;
    if (!content) {
      showToast("大模型未返回有效内容", "error");
      throw new Error("未返回有效内容");
    }

    let parsed;
    try { parsed = JSON.parse(content); }
    catch (e) {
      showToast("无法解析大模型返回的事件内容", "error");
      throw new Error("无法解析大模型返回的事件内容: " + e.message);
    }

    if (!parsed || !parsed.events || !Array.isArray(parsed.events)) {
      showToast("大模型返回的事件结构无效", "error");
      throw new Error("LLM 返回的事件结构无效");
    }
    for (const event of parsed.events) {
      if (!event.startTime || !event.endTime || !event.title) {
        showToast("解析的事件缺少必要字段", "error");
        throw new Error("解析的事件缺少必要字段");
      }
    }

    showToast(`成功解析 ${parsed.events.length} 个事件`, "info");
    return parsed;
  }

  async function handleLLMParsingAndUpload(selectedText) {
    try {
      const parsed = await parseSelectedTextWithLLM(selectedText);
      if (!parsed || !parsed.events || !parsed.events.length) {
        showToast("解析未返回可用事件", "error");
        return;
      }
      const events = parsed.events.map(ev => ({ ...ev, startTime: parseLLMTime(ev.startTime), endTime: parseLLMTime(ev.endTime) }));
      const ics = buildICS(events, "LLM-Parsed");
      const uploadResult = await uploadToRadicale(ics, "LLM-Parsed");
      if (uploadResult && uploadResult.ok) showToast(`上传成功: ${events.length} 个事件\n路径: ${uploadResult.url}`, "info");
    } catch (err) {
      showToast(`解析/上传失败: ${err.message || err}`, "error");
    }
  }

  function invokeParseModal(initialText = "") {
    showTextInputModal({
      title: "输入要解析的日程文本",
      initial: initialText || "",
      onSubmit: async (text) => {
        await handleLLMParsingAndUpload(text);
      }
    });
  }

  // 兼容旧接口（现在不再创建自定义右键菜单）
  function setupContextMenu() {
    // no-op: 原双菜单方案已移除
  }

  // 新增：注册到 Tampermonkey 菜单
  function registerMenuIntegration() {
    try {
      if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("SJTU Radicale: 解析当前选中文本", () => {
          const sel = (window.getSelection()?.toString() || "").trim();
          invokeParseModal(sel);
        });
        GM_registerMenuCommand("SJTU Radicale: 打开空白解析输入框", () => {
          invokeParseModal("");
        });
      }
    } catch {}
  }

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

  function setupCrossTabTimer() {
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

})();
