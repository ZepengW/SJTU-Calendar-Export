import { gmHttp } from "./http.js";
import { storage } from "./storage.js";
import { parseLLMTime } from "./utils.js";
import { showToast } from "./ui.js";
import { buildICS, uploadToRadicale } from "./sync.js";

export async function parseSelectedTextWithLLM(text) {
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

export async function handleLLMParsingAndUpload(selectedText) {
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
