import { DEFAULTS } from "./constants.js";

export const storage = {
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
