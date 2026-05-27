const STORAGE_KEYS = {
  apiKey: "ript_api_key",
  apiUrl: "ript_api_url",
  model: "ript_model",
  provider: "ript_provider"
};

const DEFAULT_API_URL = "https://api.moonshot.cn/v1/chat/completions";
const DEFAULT_MODEL = "kimi-k2.6";
const DEFAULT_PROVIDER = "kimi";
const PROVIDER_PRESETS = {
  kimi: {
    apiUrl: "https://api.moonshot.cn/v1/chat/completions",
    model: "kimi-k2.6",
    keyPlaceholder: "sk-..."
  },
  mimo: {
    apiUrl: "https://api.mimo-v2.com/v1/chat/completions",
    model: "mimo-v2-omni",
    keyPlaceholder: "mimo key..."
  },
  gemini: {
    apiUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    keyPlaceholder: "AIza..."
  },
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini",
    keyPlaceholder: "sk-..."
  },
  custom: {
    apiUrl: DEFAULT_API_URL,
    model: DEFAULT_MODEL,
    keyPlaceholder: "api key..."
  }
};

const providerSelect = document.querySelector("#providerName");
const apiUrlInput = document.querySelector("#apiUrl");
const apiKeyInput = document.querySelector("#apiKey");
const modelInput = document.querySelector("#modelName");
const statusEl = document.querySelector("#status");
const saveButton = document.querySelector("#saveKey");
const clearButton = document.querySelector("#clearKey");
let savedApiKey = "";

initPopup();

async function initPopup() {
  const settings = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.apiUrl,
    STORAGE_KEYS.model,
    STORAGE_KEYS.provider
  ]);

  const provider = settings[STORAGE_KEYS.provider] || inferProvider(settings[STORAGE_KEYS.apiUrl]) || DEFAULT_PROVIDER;
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS[DEFAULT_PROVIDER];
  savedApiKey = settings[STORAGE_KEYS.apiKey] || "";
  providerSelect.value = provider;
  apiUrlInput.value = settings[STORAGE_KEYS.apiUrl] || preset.apiUrl;
  apiKeyInput.value = "";
  apiKeyInput.placeholder = savedApiKey ? "已保存，留空则保留当前 Key" : preset.keyPlaceholder;
  modelInput.value = settings[STORAGE_KEYS.model] || preset.model;
  setStatus(savedApiKey && settings[STORAGE_KEYS.apiUrl] && settings[STORAGE_KEYS.model]
    ? "已绑定，可右键图片使用。"
    : "请填写 API URL、API Key 和模型名称。");
}

providerSelect.addEventListener("change", () => {
  const provider = providerSelect.value;
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
  apiUrlInput.value = preset.apiUrl;
  modelInput.value = preset.model;
  apiKeyInput.placeholder = savedApiKey ? "已保存，留空则保留当前 Key" : preset.keyPlaceholder;
  setStatus(provider === "custom"
    ? "自定义接口需兼容 OpenAI Chat Completions 视觉输入。"
    : "已切换预设，请填写或确认 API Key。");
});

saveButton.addEventListener("click", async () => {
  const provider = providerSelect.value || DEFAULT_PROVIDER;
  const apiUrl = apiUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim() || savedApiKey;
  const model = modelInput.value.trim();

  if (!apiUrl || !apiKey || !model) {
    setStatus("API URL、API Key 和模型名称都需要填写。", true);
    return;
  }

  if (!isValidHttpsUrl(apiUrl)) {
    setStatus("API URL 需要是完整的 https:// 地址。", true);
    return;
  }

  saveButton.disabled = true;
  saveButton.classList.add("is-loading");
  saveButton.textContent = "检测中...";
  setStatus("正在检测连接，请稍候。");

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "RIPT_TEST_SAVE_BINDING",
      provider,
      apiUrl,
      apiKey,
      model
    });
  } catch (error) {
    saveButton.disabled = false;
    saveButton.classList.remove("is-loading");
    saveButton.textContent = "检测并绑定";
    setStatus(error?.message || "检测失败，请检查 API URL 和 Key。", true);
    return;
  }

  saveButton.disabled = false;
  saveButton.classList.remove("is-loading");
  saveButton.textContent = "检测并绑定";

  if (!response?.ok) {
    setStatus(response?.message || "检测失败，请检查 API URL 和 Key。", true);
    return;
  }

  savedApiKey = apiKey;
  apiKeyInput.value = "";
  apiKeyInput.placeholder = "已保存，留空则保留当前 Key";
  setStatus(response.message || "检测成功，绑定已保存。");
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.remove([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.apiUrl,
    STORAGE_KEYS.model,
    STORAGE_KEYS.provider
  ]);
  const preset = PROVIDER_PRESETS[DEFAULT_PROVIDER];
  savedApiKey = "";
  providerSelect.value = DEFAULT_PROVIDER;
  apiUrlInput.value = preset.apiUrl;
  apiKeyInput.value = "";
  apiKeyInput.placeholder = preset.keyPlaceholder;
  modelInput.value = preset.model;
  setStatus("已清除绑定。");
});

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function inferProvider(apiUrl) {
  const value = String(apiUrl || "");
  if (value.includes("moonshot.cn")) return "kimi";
  if (value.includes("mimo-v2.com")) return "mimo";
  if (value.includes("generativelanguage.googleapis.com")) return "gemini";
  if (value.includes("api.openai.com")) return "openai";
  return "";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.dataset.state = isError ? "error" : "ok";
}
