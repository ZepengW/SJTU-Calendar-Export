import fs from "node:fs";

const banner = `// ==UserScript==
// @name         SJTU Calendar → Radicale Sync (Tampermonkey)
// @namespace    https://github.com/ZepengW/SJTU-Calendar-Export
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
// ==/UserScript==`;

export default {
  input: "src/index.js",
  output: {
    file: "dist/tampermonkey.user.js",
    format: "iife",
    name: "SJTUCalendarRadicaleUserscript",
    banner,
    sourcemap: false,
  },
  treeshake: false,
  plugins: [],
  onwarn(warning, warn) {
    if (warning.code === "THIS_IS_UNDEFINED") return;
    warn(warning);
  },
};
