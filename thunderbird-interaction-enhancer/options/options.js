const extensionApi = globalThis.messenger || globalThis.browser;

// Default configurations for each provider
const PROVIDER_CONFIGS = {
  ollama: {
    apiUrl: "http://localhost:11434",
    apiKey: "",
    model: "llama3.1",
    hint: "Ollama 默认地址: http://localhost:11434"
  },
  volcano: {
    apiUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: "",
    model: "doubao-seed-translation-250915",
    hint: "火山方舟 API 地址"
  },
  aliyun: {
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    model: "qwen-plus",
    hint: "阿里云百炼 API 地址"
  },
  google: {
    apiUrl: "https://translation.googleapis.com/language/translate/v2",
    apiKey: "",
    model: "",
    hint: "Google Cloud Translation API"
  },
  libretranslate: {
    apiUrl: "https://libretranslate.de",
    apiKey: "",
    model: "",
    hint: "LibreTranslate 公共实例"
  },
  custom: {
    apiUrl: "",
    apiKey: "",
    model: "",
    hint: "自定义 OpenAI 兼容接口地址"
  }
};

const MODEL_PRESETS = {
  ollama: ["llama3.1"],
  volcano: [
    "doubao-seed-translation-250915",
    "doubao-seed-translation-250728",
    "doubao-seed-2-0-lite-260428",
    "doubao-seed-2-0-mini-260428",
    "doubao-seed-2-0-pro-260215",
    "doubao-seed-2-0-lite-260215",
    "doubao-seed-2-0-mini-260215",
    "doubao-seed-2-0-code-preview-260215",
    "doubao-seed-1-8-251228",
    "doubao-seed-character-251128",
    "doubao-seed-code-preview-251028",
    "doubao-seed-1-6-251015",
    "doubao-seed-1-6-flash-250828",
    "doubao-seed-1-6-flash-250715",
    "doubao-seed-1-6-thinking-250715",
    "doubao-seed-1-6-flash-250615",
    "doubao-seed-1-6-vision-250815",
    "doubao-seed-1-6-250615",
    "doubao-1-5-pro-32k-250115",
    "doubao-1-5-pro-32k-character-250715",
    "doubao-1-5-lite-32k-250115",
    "doubao-1-5-vision-pro-32k-250115",
    "glm-4-7-251222",
    "deepseek-v4-pro-260425",
    "deepseek-v4-flash-260425",
    "deepseek-v3-2-251201",
    "deepseek-v3-1-terminus",
    "deepseek-v3-241226",
    "deepseek-r1-250120",
    "deepseek-r1-distill-qwen-32b-250120",
    "deepseek-r1-distill-qwen-37b-250120",
    "kimi-k2-250905",
    "kimi-k2-250711"
  ],
  aliyun: ["qwen-plus", "qwen-turbo", "qwen-max"],
  custom: []
};

const MODEL_ALIASES = {
  volcano: {
    "doubao-pro-32k": "doubao-1-5-pro-32k-250115",
    "doubao-seed-translation": "doubao-seed-translation-250915",
    "doubao-1.5-pro-32k": "doubao-1-5-pro-32k-250115",
    "doubao-1.5-lite-32k": "doubao-1-5-lite-32k-250115",
    "doubao-seed-1.6-flash": "doubao-seed-1-6-flash-250615",
    "doubao-seed-1.6": "doubao-seed-1-6-250615",
    "doubao-seed-2.0-lite": "doubao-seed-2-0-lite-260428",
    "doubao-seed-2.0-mini": "doubao-seed-2-0-mini-260428",
    "doubao-seed-2.0-pro": "doubao-seed-2-0-pro-260215",
    "deepseek-v3.2": "deepseek-v3-2-251201",
    "deepseek-v3.1": "deepseek-v3-1-terminus",
    "deepseek-v3": "deepseek-v3-241226",
    "deepseek-r1": "deepseek-r1-250120"
  }
};

function uniqueValues(values) {
  return [...new Set(values.map(value => (value || "").trim()).filter(Boolean))];
}

function normalizeProviderModel(provider, model) {
  const normalized = (model || "").trim();
  if (!normalized) {
    return "";
  }

  return MODEL_ALIASES[provider]?.[normalized] || normalized;
}

function setModelOptions(provider, selectedModel, models) {
  const modelSelect = document.getElementById("model");
  const modelManual = document.getElementById("modelManual");
  const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.ollama;
  const normalizedSelectedModel = normalizeProviderModel(provider, selectedModel);
  const options = uniqueValues([
    normalizedSelectedModel,
    ...(models || MODEL_PRESETS[provider] || []),
    config.model
  ]);

  modelSelect.innerHTML = "";

  if (options.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "-- 手动输入模型名称 --";
    modelSelect.appendChild(option);
    modelSelect.value = "";
    return;
  }

  options.forEach(modelName => {
    const option = document.createElement("option");
    option.value = modelName;
    option.textContent = modelName;
    modelSelect.appendChild(option);
  });

  modelSelect.value = normalizedSelectedModel || options[0];
  modelManual.value = "";
}

function getModelValue() {
  const manualModel = document.getElementById("modelManual").value.trim();
  const selectedModel = document.getElementById("model").value.trim();
  const provider = document.getElementById("provider").value;
  return normalizeProviderModel(provider, manualModel || selectedModel);
}

// Load saved settings
async function loadSettings() {
  if (!extensionApi?.storage?.local) {
    showStatus("Thunderbird 扩展 API 不可用，请在 Thunderbird 扩展页面中打开设置", "error");
    return;
  }

  const result = await extensionApi.storage.local.get([
    "provider", "apiUrl", "apiKey", "model", "targetLang", "systemPrompt", "notesIcon"
  ]);

  const provider = result.provider || "ollama";
  document.getElementById("provider").value = provider;

  const config = PROVIDER_CONFIGS[provider];
  const savedModel = result.model || config.model;
  const model = normalizeProviderModel(provider, savedModel);
  document.getElementById("apiUrl").value = result.apiUrl || config.apiUrl;
  document.getElementById("apiKey").value = result.apiKey || config.apiKey;
  setModelOptions(provider, model);
  document.getElementById("targetLang").value = result.targetLang || "zh-CN";
  document.getElementById("notesIcon").value = result.notesIcon || "icons/notes.svg";
  document.getElementById("systemPrompt").value = result.systemPrompt || "";

  updateUIForProvider(provider);

  if (savedModel && model !== savedModel) {
    await extensionApi.storage.local.set({ model });
    showStatus(`已将旧模型 ${savedModel} 更新为 ${model}`, "success");
  }
}

// Update UI based on selected provider
function updateUIForProvider(provider) {
  const config = PROVIDER_CONFIGS[provider];
  document.getElementById("apiUrlHint").textContent = config.hint;

  // Show/hide model section based on provider
  const modelSection = document.getElementById("modelSection");
  if (provider === "google" || provider === "libretranslate") {
    modelSection.style.display = "none";
  } else {
    modelSection.style.display = "block";
    document.getElementById("modelHint").textContent =
      provider === "ollama" ? "Ollama 默认模型: llama3.1" :
      provider === "volcano" ? "推荐翻译模型: doubao-seed-translation-250915；也可填写 Chat API Model ID 或 Endpoint ID" :
      provider === "aliyun" ? "例如: qwen-plus" :
      "模型名称";
  }
}

// Save settings
async function saveSettings() {
  const provider = document.getElementById("provider").value;
  const apiUrl = document.getElementById("apiUrl").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  const model = getModelValue();
  const targetLang = document.getElementById("targetLang").value;
  const notesIcon = document.getElementById("notesIcon").value;
  const systemPrompt = document.getElementById("systemPrompt").value.trim();

  if (!apiUrl) {
    showStatus("请填写 API 地址", "error");
    return;
  }

  if (provider !== "google" && provider !== "libretranslate" && !model) {
    showStatus("请选择或手动输入模型名称", "error");
    return;
  }

  await extensionApi.storage.local.set({
    provider,
    apiUrl,
    apiKey,
    model,
    targetLang,
    notesIcon,
    systemPrompt
  });

  showStatus("设置已保存", "success");
}

// Test connection via background script
async function testConnection() {
  const provider = document.getElementById("provider").value;
  const apiUrl = document.getElementById("apiUrl").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  const model = getModelValue();

  if (!apiUrl) {
    showStatus("请填写 API 地址", "error");
    return;
  }

  showStatus("正在测试连接并获取模型列表...", "success");

  try {
    const response = await extensionApi.runtime.sendMessage({
      action: "testConnection",
      provider: provider,
      apiUrl: apiUrl,
      apiKey: apiKey,
      model: model
    });

    if (response.success) {
      if (response.models && response.models.length > 0) {
        setModelOptions(provider, model || response.models[0], response.models);
        showStatus(
          response.warning
            ? `连接成功，已获取 ${response.models.length} 个模型；${response.warning}`
            : `连接成功，已获取 ${response.models.length} 个模型`,
          "success"
        );
      } else {
        showStatus("连接成功！", "success");
      }
    } else {
      showStatus(`连接失败: ${response.error}`, "error");
    }
  } catch (error) {
    showStatus(`连接错误: ${error.message}`, "error");
  }
}

function showStatus(message, type) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = type;
}

// Refresh model list from API via background script
async function refreshModelList() {
  const provider = document.getElementById("provider").value;
  const apiUrl = document.getElementById("apiUrl").value.trim();
  const apiKey = document.getElementById("apiKey").value.trim();
  const currentModel = getModelValue();

  if (!apiUrl) {
    showStatus("请填写 API 地址", "error");
    return;
  }

  showStatus("正在获取模型列表...", "success");

  try {
    const response = await extensionApi.runtime.sendMessage({
      action: "fetchModels",
      provider: provider,
      apiUrl: apiUrl,
      apiKey: apiKey
    });

    if (response.success && response.models.length > 0) {
      setModelOptions(provider, currentModel || response.models[0], response.models);
      showStatus(response.warning || `成功获取 ${response.models.length} 个模型`, "success");
    } else if (response.success) {
      showStatus("未获取到模型列表，请手动输入", "error");
    } else {
      showStatus(`获取模型列表失败: ${response.error}`, "error");
    }
  } catch (error) {
    showStatus(`获取模型列表失败: ${error.message}`, "error");
  }
}

// Event listeners
document.getElementById("provider").addEventListener("change", (e) => {
  const provider = e.target.value;
  const config = PROVIDER_CONFIGS[provider];
  document.getElementById("apiUrl").value = config.apiUrl;
  document.getElementById("apiKey").value = config.apiKey;
  setModelOptions(provider, config.model);
  updateUIForProvider(provider);
});

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("test").addEventListener("click", testConnection);
document.getElementById("refreshModels").addEventListener("click", refreshModelList);

// Load on startup
loadSettings();
