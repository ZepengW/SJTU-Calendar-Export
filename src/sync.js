import { storage } from "./storage.js";
import { gmHttp } from "./http.js";
import { DEFAULTS } from "./constants.js";
import { formatDateForAPI, isoToICSTime, parseSJTUTime, escapeICSText } from "./utils.js";
import { showToast } from "./ui.js";

export async function getProfile() {
  const url = "https://calendar.sjtu.edu.cn/api/share/profile";
  const resp = await gmHttp({ url, method: "GET" });
  if (!resp.ok) throw new Error(`profile fetch status ${resp.status}`);
  return JSON.parse(resp.responseText);
}

export async function getEventsWindow(days = 14) {
  const now = new Date();
  const start = new Date(now.getTime()); start.setDate(now.getDate() - days);
  const end = new Date(now.getTime()); end.setDate(now.getDate() + days);
  const url = `https://calendar.sjtu.edu.cn/api/event/list?startDate=${formatDateForAPI(start)}&endDate=${formatDateForAPI(end)}&weekly=false&ids=`;
  const resp = await gmHttp({ url, method: "GET" });
  if (!resp.ok) throw new Error(`events fetch status ${resp.status}`);
  return JSON.parse(resp.responseText);
}

export function buildICS(events, calendarName = "SJTU") {
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

export async function uploadToRadicale(ics, calendarName = "SJTU") {
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

export async function runSyncFlow() {
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
