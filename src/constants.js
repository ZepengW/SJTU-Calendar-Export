export const VERSION = "1.0";

export const DEFAULTS = {
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

export const allowedPages = [
  "my.sjtu.edu.cn/ui/calendar",
  "example.com/specific-page"
];

export const BC_NAME = "sjtu-radicale-sync-channel";
export const LOCK_KEY = "sjtu-radicale-sync-lock";
