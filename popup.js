const STORAGE_KEYS = {
  apiKey: "ript_api_key",
  apiUrl: "ript_api_url",
  model: "ript_model",
  provider: "ript_provider"
};

const DEFAULT_API_URL = "https://api.moonshot.cn/v1/chat/completions";
const DEFAULT_MODEL = "kimi-k2.6";

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
    STORAGE_KEYS.model
  ]);

  savedApiKey = settings[STORAGE_KEYS.apiKey] || "";
  apiUrlInput.value = settings[STORAGE_KEYS.apiUrl] || DEFAULT_API_URL;
  apiKeyInput.value = "";
  apiKeyInput.placeholder = savedApiKey ? "已保存，留空则保留当前 Key" : "sk-...";
  modelInput.value = settings[STORAGE_KEYS.model] || DEFAULT_MODEL;
  setStatus(savedApiKey && settings[STORAGE_KEYS.apiUrl] && settings[STORAGE_KEYS.model]
    ? "已绑定，可右键图片使用。"
    : "请填写 API URL、API Key 和模型名称。");
}

saveButton.addEventListener("click", async () => {
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
  savedApiKey = "";
  apiUrlInput.value = DEFAULT_API_URL;
  apiKeyInput.value = "";
  apiKeyInput.placeholder = "sk-...";
  modelInput.value = DEFAULT_MODEL;
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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.dataset.state = isError ? "error" : "ok";
}
