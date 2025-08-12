export function formatDateForAPI(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}+00:00`;
}

export function isoToICSTime(dt) {
  const s = dt.toISOString();
  return s.replace(/[-:.]/g, "").slice(0, 15) + "Z";
}

export function parseSJTUTime(s) {
  const m = s && s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

export function parseLLMTime(s) {
  if (!s) return null;
  const match = s.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{4})/);
  if (!match) return null;
  const [_, y, m, d, H, M, S, tz] = match;
  return new Date(`${y}-${m}-${d}T${H}:${M}:${S}${tz}`);
}

export function escapeICSText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/, /g, ",")
    .replace(/;/g, "\\;");
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function onReady(fn) {
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(fn, 60);
  else document.addEventListener("DOMContentLoaded", fn);
}
