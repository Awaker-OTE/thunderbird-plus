// translate.js - Popup script for translation

const extensionApi = globalThis.messenger || globalThis.browser;

const DEFAULT_SYSTEM_PROMPT = "You are a professional translator. Translate the following text accurately and naturally. Only return the translated text without any explanations.";

const LANG_NAMES = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "en": "English",
  "ja": "日本語",
  "ko": "한국어",
  "fr": "Français",
  "de": "Deutsch",
  "es": "Español",
  "ru": "Русский"
};

const MODEL_ALIASES = {
  volcano: {
    "doubao-pro-32k": "doubao-1-5-pro-32k-250115",
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

function normalizeProviderModel(provider, model) {
  const normalized = (model || "").trim();
  if (!normalized) {
    return "";
  }

  return MODEL_ALIASES[provider]?.[normalized] || normalized;
}

document.addEventListener("DOMContentLoaded", async () => {
  const closeBtn = document.getElementById("closeBtn");
  const retryBtn = document.getElementById("retryBtn");

  closeBtn.addEventListener("click", () => {
    window.close();
  });

  retryBtn.addEventListener("click", () => {
    retryBtn.style.display = "none";
    performTranslation();
  });

  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", async () => {
      if (extensionApi?.runtime?.openOptionsPage) {
        await extensionApi.runtime.openOptionsPage();
      } else {
        window.open("../options/options.html", "_blank");
      }
    });
  }

  await performTranslation();
});

async function performTranslation() {
  const originalTextEl = document.getElementById("originalText");
  const translatedTextEl = document.getElementById("translatedText");
  const providerInfoEl = document.getElementById("providerInfo");
  const retryBtn = document.getElementById("retryBtn");

  try {
    if (!extensionApi) {
      throw new Error("Thunderbird 扩展 API 不可用");
    }

    // Get current message
    const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
    const message = await extensionApi.messageDisplay.getDisplayedMessage(tabs[0].id);

    if (!message) {
      translatedTextEl.innerHTML = '<div class="error">没有检测到邮件内容</div>';
      return;
    }

    // Get full message content
    const fullMessage = await extensionApi.messages.getFull(message.id);
    const textContent = extractTextContent(fullMessage);

    if (!textContent || textContent.trim().length === 0) {
      translatedTextEl.innerHTML = '<div class="error">邮件内容为空</div>';
      return;
    }

    originalTextEl.textContent = textContent.substring(0, 2000);
    translatedTextEl.innerHTML = '<div class="loading">正在翻译...</div>';

    // Load settings
    const settings = await extensionApi.storage.local.get([
      "provider", "apiUrl", "apiKey", "model", "targetLang", "systemPrompt"
    ]);

    const provider = settings.provider || "ollama";
    const targetLang = settings.targetLang || "zh-CN";

    providerInfoEl.textContent = `翻译服务: ${provider} → ${LANG_NAMES[targetLang] || targetLang}`;

    // Perform translation
    const translated = await translateText(textContent, settings);

    translatedTextEl.textContent = translated;
  } catch (error) {
    console.error("Translation error:", error);
    translatedTextEl.innerHTML = `<div class="error">翻译失败: ${error.message}</div>`;
    retryBtn.style.display = "inline-block";
  }
}

function extractTextContent(messagePart) {
  let text = "";

  if (messagePart.body) {
    // Check if it's HTML content
    const contentType = messagePart.contentType || "";
    if (contentType.includes("text/html")) {
      // Strip HTML tags
      text = messagePart.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    } else if (contentType.includes("text/plain")) {
      text = messagePart.body;
    }
  }

  // Recursively process sub-parts
  if (messagePart.parts && messagePart.parts.length > 0) {
    for (const part of messagePart.parts) {
      const partText = extractTextContent(part);
      if (partText) {
        text += "\n" + partText;
      }
    }
  }

  return text.trim();
}

async function translateText(text, settings) {
  const provider = settings.provider || "ollama";
  const apiUrl = settings.apiUrl;
  const apiKey = settings.apiKey;
  const model = normalizeProviderModel(provider, settings.model);
  const targetLang = settings.targetLang || "zh-CN";
  const systemPrompt = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const prompt = `${systemPrompt}\n\nTranslate to ${targetLang}:\n\n${text}`;

  switch (provider) {
    case "ollama":
      return await translateOllama(apiUrl, model, prompt);
    case "volcano":
    case "aliyun":
    case "custom":
      return await translateOpenAICompatible(apiUrl, apiKey, model, prompt);
    case "google":
      return await translateGoogle(apiUrl, apiKey, text, targetLang);
    case "libretranslate":
      return await translateLibreTranslate(apiUrl, apiKey, text, targetLang);
    default:
      throw new Error(`不支持的翻译服务: ${provider}`);
  }
}

async function translateOllama(apiUrl, model, prompt) {
  const response = await fetch(buildApiUrl(apiUrl, "/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "llama3.1",
      prompt: prompt,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API 错误: ${response.status}`);
  }

  const data = await response.json();
  return data.response || data.text || "";
}

async function translateOpenAICompatible(apiUrl, apiKey, model, prompt) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(buildApiUrl(apiUrl, "/chat/completions"), {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      model: model || "default",
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || data.text || "";
}

async function translateGoogle(apiUrl, apiKey, text, targetLang) {
  const response = await fetch(`${apiUrl}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      target: targetLang,
      format: "text"
    })
  });

  if (!response.ok) {
    throw new Error(`Google Translate API 错误: ${response.status}`);
  }

  const data = await response.json();
  return data.data?.translations?.[0]?.translatedText || "";
}

async function translateLibreTranslate(apiUrl, apiKey, text, targetLang) {
  const body = {
    q: text,
    target: targetLang,
    format: "text"
  };

  if (apiKey) {
    body.api_key = apiKey;
  }

  const response = await fetch(buildApiUrl(apiUrl, "/translate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate API 错误: ${response.status}`);
  }

  const data = await response.json();
  return data.translatedText || "";
}

function normalizeApiUrl(apiUrl) {
  return apiUrl
    .trim()
    .replace(/\/+(?:chat\/completions|models|responses|api\/generate|api\/tags|translate|languages)\/?$/u, "")
    .replace(/\/+$/u, "");
}

function buildApiUrl(apiUrl, path) {
  return `${normalizeApiUrl(apiUrl)}${path}`;
}
