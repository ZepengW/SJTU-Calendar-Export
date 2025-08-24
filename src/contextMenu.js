import { handleLLMParsingAndUpload } from "./llm.js";
import { showTextInputModal } from "./ui.js";

export function invokeParseModal(initialText = "") {
  showTextInputModal({
    title: "输入要解析的日程文本",
    initial: initialText || "",
    onSubmit: async (text) => {
      await handleLLMParsingAndUpload(text);
    }
  });
}

// 兼容旧接口（现在不再创建自定义右键菜单）
export function setupContextMenu() {
  // no-op: 原双菜单方案已移除
}

// 新增：注册到 Tampermonkey 菜单
export function registerMenuIntegration() {
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
