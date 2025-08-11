// ==UserScript==
// @name         SJTU Calendar → Radicale Sync (Tampermonkey)
// @namespace    https://github.com/yourname/sjtu-radicale-sync
// @version      0.9.1
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
  "use strict";

  /*
      改动说明（v0.9.1）:
      1) 修复配置面板在部分页面不弹出的情况：将 UI 创建延迟到 DOMContentLoaded，确保在页面就绪时挂载；加入快捷键 Ctrl+Shift+R（或 Cmd+Shift+R on Mac）打开设置。
      2) 改进外观：使用现代风格的浮动齿轮按钮、模态弹窗动画、卡片样式的设置面板和更整洁的 toast 提示样式。
      3) 增强可访问性：添加 Tampermonkey 菜单命令、键盘打开、和更明显的关闭按钮。
      4) 其余逻辑保持不变（跨页锁、抓取/上传/LLM 解析流程）。
    */

  // -----------------------------
  // CONFIG / DEFAULTS
  // -----------------------------
  const DEFAULTS = {
    radicalBase: "http://127.0.0.1:5232",
    radicalUsername: "user",
    radicalAuth: "",
    autoSyncMinutes: 60,
    dateWindowDays: 14,
    enableNotifications: true,
    lastSync: null,
    llmApiUrl: "",
    llmApiKey: "",
  };

  const storage = {
    get(key) {
      try {
        return typeof GM_getValue === "function"
          ? GM_getValue(key, DEFAULTS[key])
          : JSON.parse(localStorage.getItem(key)) ?? DEFAULTS[key];
      } catch (e) {
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
    },
  };

  // -----------------------------
  // UTILITIES (same as before)
  // -----------------------------
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
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5])
    );
  }
  function escapeICSText(s) {
    if (!s) return "";
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/, /g, ",")
      .replace(/;/g, "\\;");
  }

  function gmHttp(opts) {
    return new Promise((resolve, reject) => {
      const gm =
        typeof GM_xmlhttpRequest !== "undefined"
          ? GM_xmlhttpRequest
          : window.GM && window.GM.xmlHttpRequest;
      if (!gm) {
        fetch(opts.url, {
          method: opts.method || "GET",
          headers: opts.headers || {},
          body: opts.data || undefined,
        })
          .then(async (r) => {
            const text = await r.text();
            resolve({
              status: r.status,
              responseText: text,
              finalUrl: r.url,
              ok: r.ok,
            });
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
            ok: resp.status >= 200 && resp.status < 300,
          });
        },
        onerror(err) {
          reject(err);
        },
        ontimeout() {
          reject(new Error("timeout"));
        },
      });
    });
  }

  // -----------------------------
  // NICE UI: styles + elements
  // -----------------------------
  const CSS = `
    #sr-gear-btn{ position:fixed; right:18px; bottom:18px; z-index:2147483647; width:56px; height:56px; border-radius:14px; display:flex; align-items:center; justify-content:center; box-shadow: 0 10px 30px rgba(11,116,222,0.18); backdrop-filter: blur(6px); cursor:pointer; }
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
    .sr-toast{ min-width:260px; max-width:420px; padding:10px 14px; border-radius:10px; box-shadow:0 10px 30px rgba(9,30,66,0.08); font-size:13px; }
    .sr-toast.info{ background:linear-gradient(180deg,#f8fbff,#f2f7ff); }
    .sr-toast.error{ background:linear-gradient(180deg,#ffefef,#fff6f6); border:1px solid #ffd6d6; }
    `;

  function injectStyles() {
    if (document.getElementById("sr-styles")) return;
    const s = document.createElement("style");
    s.id = "sr-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // 页面白名单
  const allowedPages = [
    "my.sjtu.edu.cn/ui/calendar", // 示例页面
    "example.com/specific-page", // 其他页面
  ];

  // 检查当前页面是否在白名单中
  function isAllowedPage() {
    const currentUrl = location.hostname + location.pathname;
    return allowedPages.some((page) => currentUrl.includes(page));
  }

  // 修改 createUIElements 函数
  function createUIElements() {
    if (!isAllowedPage()) return; // 如果当前页面不在白名单中，则不创建浮标
    if (document.getElementById("sr-gear-btn")) return;
    injectStyles();
    const btn = document.createElement("div");
    btn.id = "sr-gear-btn";
    btn.title = "打开 SJTU Radicale 同步设置 (Ctrl/Cmd+Shift+R)";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", "SJTU Radicale 设置");
    btn.style.background = "linear-gradient(180deg,#0b74de,#0668c8)";
    btn.innerHTML = `<svg class="sr-gear" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" fill="#fff"/><path d="M19.4 15a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.7 7.7 0 0 0-1.7-.9l-.4-2.7A.5.5 0 0 0 13 2h-4a.5.5 0 0 0-.5.4l-.4 2.7c-.6.2-1.1.5-1.7.9l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.7L4.5 13a7.9 7.9 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.7l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7.9l.4 2.7c.05.2.23.4.5.4h4c.27 0 .45-.2.5-.4l.4-2.7c.6-.2 1.1-.5 1.7-.9l2.5 1c.24.1.5 0 .6-.2l2-3.5c.14-.24.07-.54-.1-.7L19.4 15z" fill="#fff"/></svg>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSettingsModal(true);
    });
    document.body.appendChild(btn);

    const toastRoot = document.createElement("div");
    toastRoot.id = "sr-toast-root";
    toastRoot.className = "sr-toast-root";
    document.body.appendChild(toastRoot);
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
      t.style.transition = "opacity 400ms";
      setTimeout(() => t.remove(), 450);
    }, ttl);
    if (severity !== "error") {
      storage.get("enableNotifications") && notifyNative(text);
    }
  }
  function notifyNative(text) {
    try {
      if (typeof GM_notification === "function")
        GM_notification({ title: "Radicale Sync", text, timeout: 3000 });
      else if ("Notification" in window) {
        if (Notification.permission === "granted")
          new Notification("Radicale Sync", { body: text });
        else if (Notification.permission !== "denied")
          Notification.requestPermission().then((p) => {
            if (p === "granted")
              new Notification("Radicale Sync", { body: text });
          });
      }
    } catch (e) {
      console.error(e);
    }
  }

  function escapeHTML(s) {
    return String(s).replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])
    );
  }

  // -----------------------------
  // SETTINGS MODAL (improved layout)
  // -----------------------------
  let modalOpen = false;
  async function toggleSettingsModal(open) {
    if (open === modalOpen) return;
    modalOpen = open;
    if (open) {
      buildSettingsModal();
    } else {
      const m = document.querySelector(".sr-modal-backdrop");
      if (m) m.remove();
    }
  }

  async function buildSettingsModal() {
    // create backdrop
    const existing = document.querySelector(".sr-modal-backdrop");
    if (existing) existing.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "sr-modal-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) toggleSettingsModal(false);
    });
    const panel = document.createElement("div");
    panel.className = "sr-panel";
    panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h2>SJTU → Radicale 同步设置</h2>
              <div style="display:flex;gap:8px;align-items:center">
                <button id="sr-close" class="sr-btn ghost">关闭</button>
              </div>
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
            <p style="margin:0 0 8px 0;color:#666;font-size:13px">选中文本后可右键解析为日程。请配置 LLM API。</p>
            <label style="display:block">LLM API URL<input id="llm-url" type="text" placeholder="https://api.your-llm.com/parse"></label>
            <label style="display:block;margin-top:6px">LLM API Key / Token<input id="llm-key" type="text"></label>
            <div class="sr-actions">
              <button id="save-settings" class="sr-btn primary">保存并关闭</button>
              <button id="sync-now" class="sr-btn">立即同步</button>
            </div>
            <div style="margin-top:10px;color:#666;font-size:13px">最后同步: <span id="last-sync">n/a</span></div>
        `;
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    // fill values
    const radBase = (await storage.get("radicalBase")) || DEFAULTS.radicalBase;
    const radUser =
      (await storage.get("radicalUsername")) || DEFAULTS.radicalUsername;
    const radAuth = (await storage.get("radicalAuth")) || DEFAULTS.radicalAuth;
    const autoMins =
      (await storage.get("autoSyncMinutes")) || DEFAULTS.autoSyncMinutes;
    const winDays =
      (await storage.get("dateWindowDays")) || DEFAULTS.dateWindowDays;
    const enNotif = await storage.get("enableNotifications");
    const llmUrl = (await storage.get("llmApiUrl")) || "";
    const llmKey = (await storage.get("llmApiKey")) || "";

    document.getElementById("rad-base").value = radBase;
    document.getElementById("rad-user").value = radUser;
    document.getElementById("rad-auth").value = radAuth;
    document.getElementById("auto-mins").value = autoMins;
    document.getElementById("win-days").value = winDays;
    document.getElementById("enable-notif").checked = !!enNotif;
    document.getElementById("llm-url").value = llmUrl;
    document.getElementById("llm-key").value = llmKey;

    const last = await storage.get("lastSync");
    document.getElementById("last-sync").textContent = last
      ? new Date(last).toLocaleString()
      : "n/a";

    document
      .getElementById("sr-close")
      .addEventListener("click", () => toggleSettingsModal(false));
    document
      .getElementById("save-settings")
      .addEventListener("click", async () => {
        await storage.set(
          "radicalBase",
          document.getElementById("rad-base").value.trim()
        );
        await storage.set(
          "radicalUsername",
          document.getElementById("rad-user").value.trim()
        );
        await storage.set(
          "radicalAuth",
          document.getElementById("rad-auth").value.trim()
        );
        await storage.set(
          "autoSyncMinutes",
          Number(document.getElementById("auto-mins").value) ||
            DEFAULTS.autoSyncMinutes
        );
        await storage.set(
          "dateWindowDays",
          Number(document.getElementById("win-days").value) ||
            DEFAULTS.dateWindowDays
        );
        await storage.set(
          "enableNotifications",
          document.getElementById("enable-notif").checked
        );
        await storage.set(
          "llmApiUrl",
          document.getElementById("llm-url").value.trim()
        );
        await storage.set(
          "llmApiKey",
          document.getElementById("llm-key").value.trim()
        );
        toggleSettingsModal(false);
        showToast("设置已保存");
      });

    document.getElementById("sync-now").addEventListener("click", async (e) => {
      e.stopPropagation();
      toggleSettingsModal(false);
      showToast("开始手动同步...");
      try {
        await runSyncFlow();
      } catch (err) {
        console.error(err);
        showToast("同步失败: " + (err.message || err), "error");
      }
    });
  }

  // -----------------------------
  // SYNC FLOW (same as previous, kept modular)
  // -----------------------------
  async function getProfile() {
    const url = "https://calendar.sjtu.edu.cn/api/share/profile";
    try {
      const resp = await gmHttp({ url, method: "GET" });
      if (!resp.ok) throw new Error(`profile fetch status ${resp.status}`);
      return JSON.parse(resp.responseText);
    } catch (err) {
      throw new Error("无法获取登录信息: " + (err.message || err));
    }
  }

  async function getEventsWindow(days = 14) {
    const now = new Date();
    const start = new Date(now.getTime());
    start.setDate(now.getDate() - days);
    const end = new Date(now.getTime());
    end.setDate(now.getDate() + days);
    const url = `https://calendar.sjtu.edu.cn/api/event/list?startDate=${formatDateForAPI(
      start
    )}&endDate=${formatDateForAPI(end)}&weekly=false&ids=`;
    try {
      const resp = await gmHttp({ url, method: "GET" });
      if (!resp.ok) throw new Error(`events fetch status ${resp.status}`);
      return JSON.parse(resp.responseText);
    } catch (err) {
      throw new Error("无法获取日程: " + (err.message || err));
    }
  }

  function buildICS(events, calendarName = "SJTU") {
    const now = new Date();
    const lines = [];
    lines.push("BEGIN:VCALENDAR");
    lines.push("VERSION:2.0");
    lines.push("PRODID:-//SJTU-Radicale-Sync//EN");
    lines.push(`X-WR-CALNAME:${escapeICSText(calendarName)}`);
    lines.push(`X-WR-TIMEZONE:UTC`);
    for (const ev of events) {
      try {
        lines.push("BEGIN:VEVENT");
        const uid =
          ev.eventId || ev.id || "evt-" + Math.random().toString(36).slice(2);
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${isoToICSTime(now)}`);
        const s = parseSJTUTime(ev.startTime);
        const e = parseSJTUTime(ev.endTime);
        if (s && e) {
          lines.push(`DTSTART:${isoToICSTime(s)}`);
          lines.push(`DTEND:${isoToICSTime(e)}`);
        }
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

  async function uploadToRadicale(ics, account) {
    const base = (await storage.get("radicalBase")) || DEFAULTS.radicalBase;
    const user =
      (await storage.get("radicalUsername")) || DEFAULTS.radicalUsername;
    const auth = (await storage.get("radicalAuth")) || "";
    const baseUrl = base.replace(/\/$/, "");
    const filename = `SJTU-${account}.ics`;
    const url = `${baseUrl}/${encodeURIComponent(user)}/${encodeURIComponent(
      filename
    )}`;
    const headers = { "Content-Type": "text/calendar; charset=utf-8" };
    if (auth) headers["Authorization"] = auth;
    try {
      const resp = await gmHttp({ url, method: "PUT", headers, data: ics });
      if (resp.status === 201 || resp.status === 200 || resp.status === 204) {
        await storage.set("lastSync", Date.now());
        showToast("同步成功: " + url);
        return { ok: true, url };
      } else if (resp.status === 401 || resp.status === 403) {
        throw new Error("鉴权失败（401/403）");
      } else {
        throw new Error(
          "上传失败，HTTP " + resp.status + " " + (resp.responseText || "")
        );
      }
    } catch (err) {
      throw new Error("上传失败: " + (err.message || err));
    }
  }

  async function runSyncFlow() {
    const profile = await getProfile();
    if (
      !profile ||
      !profile.success ||
      !profile.data ||
      !profile.data.account
    ) {
      showToast("未登录或无法获取账号信息", "error");
      return;
    }
    const account = profile.data.account;
    const eventsResp = await getEventsWindow(
      (await storage.get("dateWindowDays")) || DEFAULTS.dateWindowDays
    );
    if (!eventsResp || !eventsResp.success) {
      throw new Error("获取日程返回异常");
    }
    const events = (eventsResp.data && eventsResp.data.events) || [];
    const ics = buildICS(events, `SJTU-${account}`);
    try {
      const res = await uploadToRadicale(ics, account);
      if (res && res.ok) showToast("上传到 Radicale: " + res.url);
    } catch (err) {
      showToast(err.message || String(err), "error");
      throw err;
    }
  }

  // -----------------------------
  // CROSS-TAB SINGLE TIMER (unchanged)
  // -----------------------------
  const BC_NAME = "sjtu-radicale-sync-channel";
  const LOCK_KEY = "sjtu-radicale-sync-lock";
  function setupCrossTabTimer() {
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = async (ev) => {
      try {
        if (ev.data && ev.data.type === "request-sync") {
          await tryAcquireAndRun();
        }
      } catch (err) {
        console.error(err);
      }
    };
    GM_registerMenuCommand &&
      GM_registerMenuCommand("SJTU Radicale: 手动同步", () => {
        bc.postMessage({ type: "request-sync" });
      });
    (async () => {
      const mins =
        (await storage.get("autoSyncMinutes")) || DEFAULTS.autoSyncMinutes;
      const ms = (mins || DEFAULTS.autoSyncMinutes) * 60 * 1000;
      setInterval(() => {
        bc.postMessage({ type: "request-sync" });
      }, ms);
    })();
    if (
      location.hostname.includes("my.sjtu.edu.cn") &&
      location.pathname.startsWith("/ui/calendar")
    )
      setTimeout(() => {
        const bc2 = new BroadcastChannel(BC_NAME);
        bc2.postMessage({ type: "request-sync" });
      }, 1600);
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
      } catch (e) {}
    }
    localStorage.setItem(
      LOCK_KEY,
      JSON.stringify({ ts: now, id: Math.random().toString(36).slice(2) })
    );
    try {
      console.log("acquired lock, running sync");
      await runSyncFlow();
    } catch (err) {
      console.error("sync failed", err);
    } finally {
      localStorage.removeItem(LOCK_KEY);
    }
  }

  // -----------------------------
  // CONTEXT MENU / LLM PARSING (unchanged)
  // -----------------------------
  function setupContextMenu() {
    document.addEventListener("contextmenu", (e) => {
      const sel = window.getSelection().toString().trim();
      if (!sel) return;

      const existing = document.getElementById("sjtu-ctx-menu");
      if (existing) existing.remove();

      const menu = document.createElement("div");
      menu.id = "sjtu-ctx-menu";
      Object.assign(menu.style, {
        position: "absolute",
        left: `${e.pageX}px`,
        top: `${e.pageY}px`,
        zIndex: 2147483647,
        background: "#fff",
        border: "1px solid #e6e9ef",
        padding: "6px",
        borderRadius: "8px",
        boxShadow: "0 12px 30px rgba(9,30,66,0.12)",
      });

      const btn = document.createElement("button");
      btn.textContent = "解析并上传为日程";
      Object.assign(btn.style, {
        padding: "8px 10px",
        cursor: "pointer",
        background: "#0b74de",
        color: "#fff",
        border: "none",
        borderRadius: "6px",
      });

      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        menu.remove();
        showToast("调用大模型解析文本...");
        try {
          const parsed = await parseSelectedTextWithLLM(sel);
          if (!parsed || !parsed.events || !parsed.events.length) {
            showToast("解析未返回可用事件", "error");
            return;
          }
          const profile = await getProfile();
          if (!profile || !profile.data || !profile.data.account) {
            showToast("未登录，无法上传", "error");
            return;
          }
          const ics = buildICS(parsed.events, `SJTU-${profile.data.account}`);
          await uploadToRadicale(ics, profile.data.account);
        } catch (err) {
          console.error(err);
          showToast("解析/上传失败: " + (err.message || err), "error");
        }
      });

      menu.appendChild(btn);
      document.body.appendChild(menu);

      // Prevent the native context menu from hiding the custom menu
      e.preventDefault();

      // Remove the custom menu when clicking elsewhere
      document.addEventListener(
        "click",
        () => {
          const m = document.getElementById("sjtu-ctx-menu");
          if (m) m.remove();
        },
        { once: true }
      );
    });
  }

  async function parseSelectedTextWithLLM(text) {
    const url = "https://open.bigmodel.cn/api/llm-application/open/v3/application/invoke";
    const key = (await storage.get("llmApiKey")) || "";
    if (!key) {
      console.error("LLM API Key is not configured.");
      throw new Error("未配置 LLM API Key");
    }

    const agentId = "1954810625930809344"; // Replace with your agent ID
    const headers = {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    const body = JSON.stringify({
      app_id: agentId,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: text,
            },
          ],
        },
      ],
    });

    console.log("Sending request to LLM API...");
    console.log("URL:", url);
    console.log("Headers:", headers);
    console.log("Body:", body);

    try {
      const resp = await gmHttp({ url, method: "POST", headers, data: body });
      console.log("Received response from LLM API:", resp);

      if (!resp.ok) {
        console.error("LLM API request failed with status:", resp.status);
        throw new Error("LLM 请求失败: " + resp.status);
      }

      let responseJson;
      try {
        responseJson = JSON.parse(resp.responseText);
        console.log("Parsed response JSON:", responseJson);
      } catch (e) {
        console.error("Error parsing LLM API response content:", e.message);
        throw new Error("无法解析大模型返回内容: " + e.message);
      }

      // Handle specific error case: insufficient balance or resources
      if (responseJson.status === "failed" && responseJson.error) {
        const errorMessage = responseJson.error.message || "未知错误";
        console.error("LLM API returned an error:", errorMessage);
        showToast(`大模型调用失败: ${errorMessage}`, "error");
        throw new Error(`大模型调用失败: ${errorMessage}`);
      }

      const content = responseJson.choices?.[0]?.messages?.[0]?.content;
      if (!content) {
        console.error("No valid content returned by LLM API.");
        throw new Error("未返回有效内容");
      }

      const parsed = JSON.parse(content);
      console.log("Parsed events from LLM API content:", parsed);

      if (parsed && parsed.events) {
        console.log("Successfully parsed events:", parsed.events);
        return parsed;
      } else {
        console.error("LLM API response does not contain 'events' field.");
        throw new Error("LLM 未返回 events 字段");
      }
    } catch (err) {
      console.error("Error during LLM API call:", err.message);
      throw err;
    }
  }

  // -----------------------------
  // BOOTSTRAP: create UI after DOM ready + add keyboard shortcut
  // -----------------------------
  function onReady(fn) {
    if (
      document.readyState === "complete" ||
      document.readyState === "interactive"
    )
      setTimeout(fn, 60);
    else document.addEventListener("DOMContentLoaded", fn);
  }

  onReady(() => {
    try {
      createUIElements();
      setupContextMenu();
      setupCrossTabTimer(); // keyboard shortcut Ctrl/Cmd + Shift + R
      window.addEventListener("keydown", (e) => {
        const mod = navigator.platform.toUpperCase().includes("MAC")
          ? e.metaKey
          : e.ctrlKey;
        if (mod && e.shiftKey && e.key.toLowerCase() === "r") {
          e.preventDefault();
          toggleSettingsModal(true);
        }
      }); // register menu
      try {
        GM_registerMenuCommand &&
          GM_registerMenuCommand("SJTU Radicale: 打开设置", () =>
            toggleSettingsModal(true)
          );
      } catch (e) {}
      console.log("SJTU Radicale userscript loaded (v0.9.1)");
    } catch (e) {
      console.error(e);
    }
  });
})();
