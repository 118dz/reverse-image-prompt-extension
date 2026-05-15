const MENU_ID = "reverse-image-prompt";
const STORAGE_KEYS = {
  apiKey: "ript_api_key",
  apiUrl: "ript_api_url",
  model: "ript_model",
  provider: "ript_provider"
};

const DEFAULT_API_URL = "https://api.moonshot.cn/v1/chat/completions";
const DEFAULT_MODEL = "kimi-k2.6";
const CONNECTION_TEST_TIMEOUT_MS = 20000;
const IMAGE_FETCH_TIMEOUT_MS = 20000;
const IMAGE_ANALYSIS_TIMEOUT_MS = 45000;
const IMAGE_ANALYSIS_WATCHDOG_MS = 50000;
const ANALYSIS_MAX_TOKENS = 500;

chrome.runtime.onInstalled.addListener(setupContextMenu);
chrome.runtime.onStartup.addListener(setupContextMenu);

function setupContextMenu() {
  chrome.contextMenus.remove(MENU_ID, () => {
    chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "反推图片提示词",
      contexts: ["image"]
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !info.srcUrl) return;

  await ensureContentScript(tab.id);
  const clickPoint = await getLastImageContextPoint(tab.id);

  await startReverseImageFlow({
    tabId: tab.id,
    srcUrl: info.srcUrl,
    point: clickPoint
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RIPT_TEST_SAVE_BINDING") return false;

  handleBindingMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({
      ok: false,
      message: normalizeError(error)
    }));

  return true;
});

async function startReverseImageFlow({ tabId, srcUrl, point }) {
  const settings = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.apiUrl,
    STORAGE_KEYS.model
  ]);

  const apiKey = settings[STORAGE_KEYS.apiKey];
  const apiUrl = settings[STORAGE_KEYS.apiUrl];
  const model = settings[STORAGE_KEYS.model] || DEFAULT_MODEL;

  if (!apiKey || !apiUrl || !model) {
    await sendToTab(tabId, {
      type: "RIPT_SHOW_SETTINGS_REQUIRED",
      point
    });
    return;
  }

  await analyzeImage({
    tabId,
    srcUrl,
    point,
    apiKey,
    apiUrl,
    model
  });
}

async function handleBindingMessage(message, sender) {
  if (sender.tab?.id) {
    throw new Error("请在扩展弹窗中绑定 API，网页内不接收 API Key。");
  }

  const apiUrl = String(message.apiUrl || "").trim();
  const apiKey = String(message.apiKey || "").trim();
  const model = String(message.model || DEFAULT_MODEL).trim();
  if (!apiUrl || !apiKey || !model) {
    throw new Error("API URL、API Key 和模型名称都需要填写。");
  }

  const workingEndpoint = await testApiConnection({ apiKey, apiUrl, model });

  await chrome.storage.local.set({
    [STORAGE_KEYS.apiUrl]: workingEndpoint,
    [STORAGE_KEYS.apiKey]: apiKey,
    [STORAGE_KEYS.model]: model
  });
  await chrome.storage.local.remove(STORAGE_KEYS.provider);

  return {
    ok: true,
    message: "检测成功，绑定已保存。请回到网页右键图片开始分析。"
  };
}

async function testApiConnection({ apiKey, apiUrl, model }) {
  const endpoint = normalizeApiUrl(apiUrl);
  const resolved = await resolveWorkingEndpoint({ apiKey, endpoint, model, imageDataUrl: null, testOnly: true });
  return resolved.endpoint;
}

async function resolveWorkingEndpoint({ apiKey, endpoint, model, imageDataUrl, testOnly = false }) {
  const mode = detectApiMode(endpoint);
  const attempts = buildEndpointAttempts(endpoint, mode);
  let lastError = null;

  for (const attempt of attempts) {
    try {
      if (testOnly) {
        if (attempt.mode === "chat") {
          await testChatCompletions({ apiKey, endpoint: attempt.endpoint, model });
        } else {
          await testResponses({ apiKey, endpoint: attempt.endpoint, model });
        }
      } else if (attempt.mode === "chat") {
        return {
          endpoint: attempt.endpoint,
          mode: attempt.mode,
          result: await callChatCompletions({ apiKey, endpoint: attempt.endpoint, model, imageDataUrl })
        };
      } else {
        return {
          endpoint: attempt.endpoint,
          mode: attempt.mode,
          result: await callResponses({ apiKey, endpoint: attempt.endpoint, model, imageDataUrl })
        };
      }

      return {
        endpoint: attempt.endpoint,
        mode: attempt.mode
      };
    } catch (error) {
      lastError = error;
      if (!isEndpointNotFoundError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("API URL 不存在，请检查接口路径。");
}

async function analyzeImage({ tabId, srcUrl, point, apiKey, apiUrl, model }) {
  await sendProgress(tabId, point, 8, "准备读取图片");
  try {
    await sendProgress(tabId, point, 22, "正在转换图片");
    const imageDataUrl = await imageUrlToDataUrl(srcUrl);

    await sendProgress(tabId, point, 58, "正在请求 AI 分析");
    const result = await withTimeout(
      reverseImagePrompt({
        apiKey,
        apiUrl,
        model,
        imageDataUrl
      }),
      IMAGE_ANALYSIS_WATCHDOG_MS,
      "AI 生成超过 50 秒，已自动停止。建议换较小图片、稍后重试，或在弹窗里换更快的视觉模型。"
    );

    await sendProgress(tabId, point, 92, "正在整理结果");
    await sendToTab(tabId, {
      type: "RIPT_SHOW_RESULT",
      result,
      point
    });
  } catch (error) {
    await sendToTab(tabId, {
      type: "RIPT_SHOW_ERROR",
      message: normalizeError(error),
      point
    });
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "RIPT_PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function sendProgress(tabId, point, percent, label) {
  await sendToTab(tabId, {
    type: "RIPT_SHOW_PROGRESS",
    percent,
    label,
    point
  });
}

async function getLastImageContextPoint(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "RIPT_GET_LAST_CONTEXT_POINT"
    });
    if (response?.point) return response.point;
  } catch {
    // Use the default point below if the page did not answer in time.
  }

  return { x: 120, y: 120 };
}

async function imageUrlToDataUrl(url) {
  if (url.startsWith("data:image/")) {
    return url;
  }

  const response = await fetchWithTimeout(url, {
    credentials: "include",
    cache: "force-cache"
  }, IMAGE_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`图片读取失败：HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const maxBytes = 8 * 1024 * 1024;
  if (blob.size > maxBytes) {
    throw new Error("图片过大，请换一张小于 8MB 的图片。");
  }

  const mimeType = blob.type || "image/png";
  const compressed = await compressImageBlob(blob).catch(() => null);
  if (compressed) return compressed;

  const base64 = await blobToBase64(blob);
  return `data:${mimeType};base64,${base64}`;
}

async function compressImageBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const outputBlob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.8
  });

  const base64 = await blobToBase64(outputBlob);
  return `data:image/jpeg;base64,${base64}`;
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function reverseImagePrompt({ apiKey, apiUrl, model, imageDataUrl }) {
  const endpoint = normalizeApiUrl(apiUrl);
  const chatEndpoint = endpoint.includes("/chat/completions")
    ? endpoint
    : endpoint.replace(/\/responses\/?$/, "/chat/completions");
  return callChatCompletions({
    apiKey,
    endpoint: chatEndpoint,
    model,
    imageDataUrl
  });
}

async function testResponses({ apiKey, endpoint, model }) {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: getHeaders(apiKey),
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "连接测试。请只回复 OK。"
            }
          ]
        }
      ],
      max_output_tokens: 16
    })
  }, CONNECTION_TEST_TIMEOUT_MS);

  await parseJsonResponse(response);
}

async function testChatCompletions({ apiKey, endpoint, model }) {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: getHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "连接测试。请只回复 OK。"
        }
      ],
      max_tokens: 16
    })
  }, CONNECTION_TEST_TIMEOUT_MS);

  await parseJsonResponse(response);
}

function normalizeApiUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("请先填写 API URL。");
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("API URL 格式不正确，请填写完整的 https:// 地址。");
  }

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");

  if (!url.pathname || url.pathname === "/") {
    url.pathname = isOfficialOpenAIEndpoint(url.toString()) ? "/v1/responses" : "/v1/chat/completions";
  } else if (url.pathname === "/v1") {
    url.pathname = isOfficialOpenAIEndpoint(url.toString()) ? "/v1/responses" : "/v1/chat/completions";
  }

  return url.toString();
}

function detectApiMode(endpoint) {
  return endpoint.includes("/chat/completions") ? "chat" : "responses";
}

function buildEndpointAttempts(endpoint, mode) {
  if (mode === "chat") {
    return [{ endpoint, mode }];
  }

  const fallback = endpoint.replace(/\/responses\/?$/, "/chat/completions");

  if (!isOfficialOpenAIEndpoint(endpoint) && fallback !== endpoint) {
    return [
      {
        endpoint: fallback,
        mode: "chat"
      },
      {
        endpoint,
        mode: "responses"
      }
    ];
  }

  const attempts = [{ endpoint, mode: "responses" }];
  if (fallback !== endpoint) {
    attempts.push({
      endpoint: fallback,
      mode: "chat"
    });
  }
  return attempts;
}

function isOfficialOpenAIEndpoint(endpoint) {
  try {
    const hostname = new URL(endpoint).hostname;
    return hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function isEndpointNotFoundError(error) {
  return error?.status === 404 || /HTTP 404|not found|不存在/i.test(error?.message || "");
}

async function callResponses({ apiKey, endpoint, model, imageDataUrl }) {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: getHeaders(apiKey),
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: getPromptText()
            },
            {
              type: "input_image",
              image_url: imageDataUrl
            }
          ]
        }
      ],
      max_output_tokens: ANALYSIS_MAX_TOKENS
    })
  }, IMAGE_ANALYSIS_TIMEOUT_MS);

  const payload = await parseJsonResponse(response);
  return parseAIResponse(extractResponsesText(payload));
}

async function callChatCompletions({ apiKey, endpoint, model, imageDataUrl }) {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: getHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "你是图像风格提示词提炼助手。只输出一段中文风格提示词，不要 JSON，不要解释。"
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl
              }
            },
            {
              type: "text",
              text: getPromptText()
            }
          ]
        }
      ],
      ...getModelSpecificOptions(model),
      max_tokens: ANALYSIS_MAX_TOKENS
    })
  }, IMAGE_ANALYSIS_TIMEOUT_MS);

  const payload = await parseJsonResponse(response);
  const text = payload?.choices?.[0]?.message?.content || "";
  return parseAIResponse(text);
}

function getHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };
}

function getModelSpecificOptions(model) {
  if (/^kimi-k/i.test(String(model || ""))) {
    return {
      thinking: {
        type: "disabled"
      }
    };
  }
  return {};
}

async function fetchWithTimeout(url, options, timeoutMs = IMAGE_ANALYSIS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError" || /aborted/i.test(error?.message || "")) {
      throw new Error(`请求超时或连接中断，已等待 ${Math.round(timeoutMs / 1000)} 秒。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `AI 请求失败：HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function getPromptText() {
  return [
    "观察参考图，只输出一段中文风格提示词，供用户粘贴到其他生图模型里复用这张图的画面韵味。",
    "不要生成 JSON、Markdown、标题、分点、解释、负面提示词或参数建议。",
    "不要写“替换为主体”这类占位符；用户会自己在前面加主体，你只负责风格层。",
    "不要 100% 复刻原图，不要写具体 logo、品牌名、电影片名、明星名、准确文字或演职员表。",
    "如果原图含文字/logo，只抽象为“预留文字区”“大面积留白”“标识留白”等版面描述。",
    "提示词只描述可迁移风格：构图、光影、色彩比例、材质颗粒、时代气质、情绪氛围、画面节奏。",
    "如果图片信息不足，请写“无法确认”，不要编造。",
    "长度控制在 120-180 个中文字符，必须是一整段，可直接复制。"
  ].join("\n");
}

function cleanupPromptText(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || trimmed)
    .replace(/^【?风格提示词】?[：:]\s*/i, "")
    .replace(/^风格提示词[：:]\s*/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

function extractResponsesText(payload) {
  if (payload.output_text) return payload.output_text;

  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function parseAIResponse(text) {
  if (!text) {
    throw new Error("AI 没有返回可解析内容。");
  }

  const prompt = cleanupPromptText(text);
  if (!prompt) {
    throw new Error("AI 没有返回可用的风格提示词。");
  }

  return {
    prompt,
    raw: text
  };
}

function normalizeError(error) {
  const message = error?.message || "未知错误，请稍后重试。";
  if (/401|api key|unauthorized|Incorrect API key/i.test(message)) {
    return "API Key 无效或权限不足，请检查后重试。";
  }
  if (/token|令牌|无效的令牌/i.test(message)) {
    return "API Key 或令牌无效，请确认 API URL 和 Key 来自同一个服务商。";
  }
  if (/rate limit|429/i.test(message)) {
    return "请求过于频繁或额度不足，请稍后重试。";
  }
  if (/无可用渠道|distributor|channel/i.test(message)) {
    return "当前模型在你的账号分组下没有可用渠道。请在扩展弹窗把模型名称改成账号已开放的视觉模型。";
  }
  if (/too large|maximum|图片过大/i.test(message)) {
    return "图片过大，请换一张较小的图片。";
  }
  if (/HTTP 404|not found|不存在/i.test(message)) {
    return "API URL 路径不存在。请确认接口地址是否应填写为 /v1/chat/completions，很多第三方中转不支持 /v1/responses。";
  }
  if (/Failed to fetch|NetworkError/i.test(message)) {
    return "无法连接 API URL，请检查地址是否正确，或该接口是否允许浏览器扩展访问。";
  }
  if (/aborted|abort|请求超时|连接中断/i.test(message)) {
    return "AI 请求已等待 45 秒仍未返回，已自动停止。可能是图片较大、模型渠道排队或接口网关超时，请换一张图或稍后重试。";
  }
  return message;
}
