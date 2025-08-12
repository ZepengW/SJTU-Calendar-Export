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

export async function uploadToRadicale(ics, calendarName = "SJTU") {
  const base = storage.get("radicalBase") || DEFAULTS.radicalBase;
  const user = storage.get("radicalUsername") || DEFAULTS.radicalUsername;
  const auth = storage.get("radicalAuth") || "";
  const baseUrl = base.replace(/\/$/, "");
  const url = `${baseUrl}/${encodeURIComponent(user)}/${encodeURIComponent(calendarName)}.ics`;
  const headers = { "Content-Type": "text/calendar; charset=utf-8" };
  if (auth) headers["Authorization"] = auth;

  const resp = await gmHttp({ url, method: "PUT", headers, data: ics });
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
