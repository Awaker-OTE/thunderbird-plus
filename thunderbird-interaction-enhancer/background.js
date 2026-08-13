const extensionApi = globalThis.messenger || globalThis.browser;
let lastDisplayedMessageReference = null;
const NOTES_DB_NAME = "thunderbird-interaction-enhancer-notes";
const NOTES_DB_VERSION = 1;
const NOTES_DEFAULT_FOLDER_ID = "default";

if (!extensionApi) {
  throw new Error("Thunderbird extension API is not available");
}

// Initialize native-window helpers. Keep the rest of the extension alive if
// an experiment API fails to load after an update.
extensionApi.doubleClickCloseTab?.init?.().catch(error => {
  console.error("Failed to initialize Thunderbird Plus window helpers:", error);
});
registerNotesSpace().catch(error => {
  console.error("Failed to register notes space:", error);
});

// Add context menu item for settings
extensionApi.menus.create({
  id: "open-settings",
  title: "翻译设置",
  contexts: ["browser_action"]
});
createMenuItem({
  id: "save-selection-to-note",
  title: "保存选中内容到备忘录",
  contexts: ["selection"]
});
createMenuItem({
  id: "append-selection-to-current-note",
  title: "追加选中内容到当前备忘录",
  contexts: ["selection"]
});
createMenuItem({
  id: "save-message-to-note",
  title: "存入备忘录",
  contexts: ["message_list"]
});
createMenuItem({
  id: "append-message-to-current-note",
  title: "追加邮件到当前备忘录",
  contexts: ["message_list"]
});
createMenuItem({
  id: "message-to-checklist-note",
  title: "转为备忘录清单",
  contexts: ["message_list"]
});
createMenuItem({
  id: "copy-mailbox-address",
  title: "复制邮箱地址",
  contexts: ["folder_pane"],
  enabled: false
});
createMenuItem({
  id: "translate-message-action",
  title: "翻译",
  contexts: ["message_display_action_menu"]
});
createMenuItem({
  id: "save-message-action-to-note",
  title: "存入备忘录",
  contexts: ["message_display_action_menu"]
});
createMenuItem({
  id: "append-message-action-to-current-note",
  title: "追加到当前备忘录",
  contexts: ["message_display_action_menu"]
});
createMenuItem({
  id: "message-action-to-checklist-note",
  title: "转为备忘录清单",
  contexts: ["message_display_action_menu"]
});
createMenuItem({
  id: "summarize-message-action-to-note",
  title: "总结到备忘录",
  contexts: ["message_display_action_menu"]
});
createMenuItem({
  id: "open-related-message-action-notes",
  title: "打开相关备忘录",
  contexts: ["message_display_action_menu"]
});
createMenuItem({
  id: "native-note-delete",
  title: "删除",
  contexts: ["all"],
  documentUrlPatterns: ["moz-extension://*/notes/notes.html"]
});
createMenuItem({
  id: "native-note-restore",
  title: "恢复",
  contexts: ["all"],
  documentUrlPatterns: ["moz-extension://*/notes/notes.html"]
});
createMenuItem({
  id: "native-note-permanent-delete",
  title: "永久删除",
  contexts: ["all"],
  documentUrlPatterns: ["moz-extension://*/notes/notes.html"]
});

extensionApi.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-settings") {
    openOptionsPage();
  } else if (info.menuItemId === "translate-message-action") {
    translateDisplayedMessageInline(tab).catch(error => {
      console.error("Inline translation failed:", error);
      if (tab?.id !== undefined) {
        showInlineTranslation(tab.id, {
          status: "error",
          title: "邮件翻译失败",
          message: error.message
        }).catch(console.error);
      }
    });
  } else if (info.menuItemId === "save-selection-to-note") {
    saveSelectionToNote(info, tab).catch(error => {
      console.error("Save selected text to note failed:", error);
    });
  } else if (info.menuItemId === "append-selection-to-current-note") {
    appendSelectionToCurrentNote(info, tab).catch(error => {
      console.error("Append selected text to current note failed:", error);
    });
  } else if (
    info.menuItemId === "save-message-to-note" ||
    info.menuItemId === "save-message-action-to-note"
  ) {
    saveDisplayedMessageToNote(tab, info).catch(error => {
      console.error("Save message to note failed:", error);
    });
  } else if (info.menuItemId === "append-message-to-current-note") {
    appendDisplayedMessageToCurrentNote(tab, info).catch(error => {
      console.error("Append message to current note failed:", error);
    });
  } else if (info.menuItemId === "append-message-action-to-current-note") {
    appendDisplayedMessageToCurrentNote(tab, info).catch(error => {
      console.error("Append message to current note failed:", error);
    });
  } else if (
    info.menuItemId === "message-to-checklist-note" ||
    info.menuItemId === "message-action-to-checklist-note"
  ) {
    saveDisplayedMessageToChecklist(tab, info).catch(error => {
      console.error("Save message checklist to note failed:", error);
    });
  } else if (info.menuItemId === "copy-mailbox-address") {
    copyMailboxAddressFromMenu(info).catch(error => {
      console.error("Copy mailbox address failed:", error);
    });
  } else if (info.menuItemId === "summarize-message-action-to-note") {
    summarizeDisplayedMessageToNote(tab, info).catch(error => {
      console.error("Summarize message to note failed:", error);
    });
  } else if (info.menuItemId === "open-related-message-action-notes") {
    openRelatedDisplayedMessageNotes(tab, info).catch(error => {
      console.error("Open related message notes failed:", error);
    });
  } else if (
    info.menuItemId === "native-note-delete" ||
    info.menuItemId === "native-note-restore" ||
    info.menuItemId === "native-note-permanent-delete"
  ) {
    extensionApi.runtime.sendMessage({
      action: "executeNativeMenuAction",
      menuItemId: info.menuItemId
    }).catch(() => {});
  }
});

if (extensionApi.menus?.onShown && extensionApi.menus?.update) {
  extensionApi.menus.onShown.addListener(info => {
    if (!info.contexts?.includes("folder_pane")) {
      return;
    }

    updateCopyMailboxAddressMenu(info).catch(error => {
      console.error("Update copy mailbox address menu failed:", error);
    });
  });
}

// Handle browser action click to open settings
extensionApi.browserAction.onClicked.addListener(() => {
  openOptionsPage();
});

if (extensionApi.messageDisplayAction?.onClicked) {
  extensionApi.messageDisplayAction.onClicked.addListener(() => {
    extensionApi.tabs.create({
      url: extensionApi.runtime.getURL("message-action/action.html")
    });
  });
}

if (extensionApi.messageDisplay?.onMessageDisplayed) {
  extensionApi.messageDisplay.onMessageDisplayed.addListener((tab, message) => {
    lastDisplayedMessageReference = buildMessageReference(message, tab);
    updateDisplayedMessageNoteIndicator(tab, message).catch(error => {
      console.error("Update message notes indicator failed:", error);
    });
  });
}

if (extensionApi.messageDisplay?.onMessagesDisplayed) {
  extensionApi.messageDisplay.onMessagesDisplayed.addListener((tab, messages) => {
    const message = Array.isArray(messages) ? messages[0] : messages?.messages?.[0];
    if (message) {
      lastDisplayedMessageReference = buildMessageReference(message, tab);
      updateDisplayedMessageNoteIndicator(tab, message).catch(error => {
        console.error("Update message notes indicator failed:", error);
      });
    } else {
      clearDisplayedMessageNoteIndicator(tab).catch(error => {
        console.error("Clear message notes indicator failed:", error);
      });
    }
  });
}

// Handle messages from options page
extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchModels") {
    fetchModels(request.provider, request.apiUrl, request.apiKey)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "testConnection") {
    testConnection(request.provider, request.apiUrl, request.apiKey, request.model)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "getLastDisplayedMessageReference") {
    getLastDisplayedMessageReference()
      .then(message => sendResponse({ success: true, message }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "translateDisplayedMessageInline") {
    translateDisplayedMessageInline(sender.tab || request.tab || null)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "saveDisplayedMessageToNote") {
    saveDisplayedMessageToNote(sender.tab || request.tab || null, request)
      .then(note => sendResponse({ success: true, note }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "appendDisplayedMessageToCurrentNote") {
    appendDisplayedMessageToCurrentNote(sender.tab || request.tab || null, request)
      .then(note => sendResponse({ success: true, note }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "saveDisplayedMessageToChecklist") {
    saveDisplayedMessageToChecklist(sender.tab || request.tab || null, request)
      .then(note => sendResponse({ success: true, note }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "getDisplayedMessageNoteStatus") {
    getDisplayedMessageNoteStatus(sender.tab || request.tab || null, request)
      .then(status => sendResponse({ success: true, status }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "openRelatedDisplayedMessageNotes") {
    openRelatedDisplayedMessageNotes(sender.tab || request.tab || null, request)
      .then(status => sendResponse({ success: true, status }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "saveDisplayedMessageQuickNote") {
    saveDisplayedMessageQuickNote(sender.tab || request.tab || null, request)
      .then(note => sendResponse({ success: true, note }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "appendDisplayedMessageQuickNoteToCurrentNote") {
    appendDisplayedMessageQuickNoteToCurrentNote(sender.tab || request.tab || null, request)
      .then(note => sendResponse({ success: true, note }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === "summarizeDisplayedMessageToNote") {
    summarizeDisplayedMessageToNote(sender.tab || request.tab || null, request)
      .then(note => sendResponse({ success: true, note }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

extensionApi.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.notesIcon) {
    registerNotesSpace().catch(console.error);
  }
});

const VOLCANO_MODEL_PRESETS = [
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
];

const DEFAULT_TRANSLATION_MODEL = "doubao-seed-translation-250915";
const DEFAULT_SYSTEM_PROMPT = "You are a professional translator. Translate the following text accurately and naturally. Only return the translated text without any explanations.";
const DEFAULT_SUMMARY_MODELS = {
  ollama: "llama3.1",
  volcano: "doubao-seed-2-0-lite-260428",
  aliyun: "qwen-plus"
};

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

const VOLCANO_TRANSLATION_LANGS = {
  "zh-CN": "zh",
  "zh-TW": "zh-Hant",
  "en": "en",
  "ja": "ja",
  "ko": "ko",
  "fr": "fr",
  "de": "de",
  "es": "es",
  "ru": "ru"
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

function openOptionsPage() {
  if (extensionApi.runtime.openOptionsPage) {
    extensionApi.runtime.openOptionsPage();
    return;
  }

  extensionApi.tabs.create({
    url: extensionApi.runtime.getURL("options/options.html")
  });
}

async function resolveActiveTab(tab = null) {
  if (tab?.id !== undefined) {
    return tab;
  }

  if (extensionApi.tabs?.query) {
    const tabs = await extensionApi.tabs.query({
      active: true,
      currentWindow: true
    });
    if (tabs?.[0]?.id !== undefined) {
      return tabs[0];
    }
  }

  return null;
}

function createMenuItem(properties) {
  try {
    extensionApi.menus.create(properties);
  } catch (error) {
    console.warn(`Could not create menu item ${properties.id}:`, error);
  }
}

async function updateCopyMailboxAddressMenu(info) {
  const email = await resolveMailboxEmailFromMenuInfo(info);
  await extensionApi.menus.update("copy-mailbox-address", {
    enabled: Boolean(email),
    title: "复制邮箱地址"
  });
  await extensionApi.menus.refresh?.();
}

async function copyMailboxAddressFromMenu(info) {
  const email = await resolveMailboxEmailFromMenuInfo(info);
  if (!email) {
    throw new Error("没有找到该账号的邮箱地址");
  }
  await writeTextToClipboard(email);
}

async function resolveMailboxEmailFromMenuInfo(info) {
  const account = await resolveMailboxAccountFromMenuInfo(info);
  return getPrimaryAccountEmail(account);
}

async function resolveMailboxAccountFromMenuInfo(info) {
  if (info.selectedAccount) {
    return info.selectedAccount;
  }

  const selectedFolders = Array.isArray(info.selectedFolders)
    ? info.selectedFolders
    : info.selectedFolder
      ? [info.selectedFolder]
      : [];
  const accountId = selectedFolders[0]?.accountId;
  if (!accountId || !extensionApi.accounts?.get) {
    return null;
  }

  try {
    return await extensionApi.accounts.get(accountId, false);
  } catch (error) {
    console.warn("Could not resolve account for folder pane menu:", error);
    return null;
  }
}

function getPrimaryAccountEmail(account) {
  return (
    account?.identities
      ?.map(identity => (identity?.email || "").trim())
      .find(Boolean) || ""
  );
}

async function writeTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn("navigator.clipboard.writeText failed, using fallback:", error);
    }
  }

  if (extensionApi.doubleClickCloseTab?.copyTextToClipboard) {
    await extensionApi.doubleClickCloseTab.copyTextToClipboard(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
  (document.body || document.documentElement).appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("document.execCommand('copy') returned false");
    }
  } finally {
    textarea.remove();
  }
}

async function getLastDisplayedMessageReference() {
  if (lastDisplayedMessageReference) {
    return lastDisplayedMessageReference;
  }

  if (extensionApi.messageDisplay?.getDisplayedMessage) {
    const message = await extensionApi.messageDisplay.getDisplayedMessage();
    if (message) {
      lastDisplayedMessageReference = buildMessageReference(message, null);
      return lastDisplayedMessageReference;
    }
  }

  throw new Error("请先在 Thunderbird 中打开或选中一封邮件");
}

function buildMessageReference(message, tab) {
  const date = message?.date ? new Date(message.date) : null;
  const dateValue = date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";

  return {
    id: message?.id || null,
    headerMessageId: message?.headerMessageId || "",
    subject: message?.subject || "无主题",
    author: normalizeAddressList(message?.author),
    recipients: normalizeAddressList(message?.recipients),
    date: dateValue,
    tabId: tab?.id ?? null
  };
}

function normalizeAddressList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return value ? String(value) : "";
}

async function saveDisplayedMessageToNote(tab, source = {}) {
  const message = await resolveDisplayedMessage(tab, source);
  if (!message) {
    throw new Error("没有检测到当前邮件");
  }

  const fullMessage = await extensionApi.messages.getFull(message.id);
  const textContent = extractTextContent(fullMessage);
  const note = await createNoteFromMessage(message, textContent);
  await updateDisplayedMessageNoteIndicator(tab, message);
  await openSavedNote(note.id);
  return note;
}

async function saveSelectionToNote(info, tab) {
  const selectionText = (info.selectionText || "").trim();
  if (!selectionText) {
    throw new Error("没有选中的文本");
  }

  let message = null;
  try {
    message = await resolveDisplayedMessage(tab, info);
  } catch (error) {
    message = null;
  }

  const note = await createNoteFromSelection(selectionText, message);
  await openSavedNote(note.id);
  return note;
}

async function appendSelectionToCurrentNote(info, tab) {
  const selectionText = (info.selectionText || "").trim();
  if (!selectionText) {
    throw new Error("没有选中的文本");
  }

  let message = null;
  try {
    message = await resolveDisplayedMessage(tab, info);
  } catch (error) {
    message = null;
  }

  const reference = message ? buildMessageReference(message, null) : null;
  const body = `
    <h3>追加选中内容 · ${formatNoteDateTime(new Date().toISOString())}</h3>
    ${reference ? buildMailReferenceHtml(reference) : ""}
    <blockquote>${escapeHtml(selectionText).replace(/\n/g, "<br>")}</blockquote>
  `;
  const note = await appendToCurrentNote(body, reference);
  await openSavedNote(note.id);
  return note;
}

async function appendDisplayedMessageToCurrentNote(tab, source = {}) {
  const message = await resolveDisplayedMessage(tab, source);
  if (!message) {
    throw new Error("没有检测到当前邮件");
  }

  const fullMessage = await extensionApi.messages.getFull(message.id);
  const textContent = extractTextContent(fullMessage);
  const reference = buildMessageReference(message, null);
  const excerpt = buildExcerpt(textContent, 1200);
  const body = `
    <h3>追加邮件 · ${formatNoteDateTime(new Date().toISOString())}</h3>
    ${buildMailReferenceHtml(reference)}
    ${excerpt ? `<p>${escapeHtml(excerpt).replace(/\n/g, "<br>")}</p>` : ""}
  `;
  const note = await appendToCurrentNote(body, reference);
  await updateDisplayedMessageNoteIndicator(tab, message);
  await openSavedNote(note.id);
  return note;
}

async function saveDisplayedMessageToChecklist(tab, source = {}) {
  const message = await resolveDisplayedMessage(tab, source);
  if (!message) {
    throw new Error("没有检测到当前邮件");
  }

  const fullMessage = await extensionApi.messages.getFull(message.id);
  const textContent = extractTextContent(fullMessage);
  const note = await createChecklistNoteFromMessage(message, textContent);
  await updateDisplayedMessageNoteIndicator(tab, message);
  await openSavedNote(note.id);
  return note;
}

async function summarizeDisplayedMessageToNote(tab, source = {}) {
  const message = await resolveDisplayedMessage(tab, source);
  if (!message) {
    throw new Error("没有检测到当前邮件");
  }

  const fullMessage = await extensionApi.messages.getFull(message.id);
  const textContent = extractTextContent(fullMessage);
  if (!textContent) {
    throw new Error("邮件正文为空，无法总结");
  }

  const settings = await extensionApi.storage.local.get([
    "provider", "apiUrl", "apiKey", "model", "targetLang", "systemPrompt"
  ]);
  const reference = buildMessageReference(message, null);
  const summary = await summarizeText(textContent, reference, settings);
  const note = await createSummaryNoteFromMessage(message, summary);
  await updateDisplayedMessageNoteIndicator(tab, message);
  await openSavedNote(note.id);
  return note;
}

async function getDisplayedMessageNoteStatus(tab, source = {}) {
  const message = await resolveDisplayedMessage(tab, source);
  if (!message) {
    return { count: 0, notes: [] };
  }

  const notes = await findRelatedNotesForMessage(message);
  updateDisplayedMessageNoteIndicator(tab, message).catch(error => {
    console.error("Update message notes indicator failed:", error);
  });
  return {
    count: notes.length,
    notes: notes.map(note => ({
      id: note.id,
      title: note.title || "新建备忘录",
      updatedAt: note.updatedAt || "",
      sourceMessageId: note.sourceMessageId || null,
      sourceHeaderMessageId: note.sourceHeaderMessageId || ""
    }))
  };
}

async function updateDisplayedMessageNoteIndicator(tab, message = null) {
  const actionApi = extensionApi.messageDisplayAction;
  if (!actionApi?.setTitle || !actionApi?.setBadgeText) {
    return { count: 0 };
  }

  if (!message) {
    message = await resolveDisplayedMessage(tab).catch(() => null);
  }

  if (!message) {
    await clearDisplayedMessageNoteIndicator(tab);
    return { count: 0 };
  }

  const notes = await findRelatedNotesForMessage(message);
  const count = notes.length;
  const details = getMessageActionTabDetails(tab);
  const title = count > 0
    ? `Thunderbird Plus · 已有 ${count} 条备忘录`
    : "Thunderbird Plus";

  await actionApi.setTitle({
    ...details,
    title
  });
  await actionApi.setBadgeText({
    ...details,
    text: count > 0 ? (count > 99 ? "99+" : String(count)) : ""
  });

  if (count > 0) {
    await actionApi.setBadgeBackgroundColor?.({
      ...details,
      color: "#2563eb"
    });
    await actionApi.setBadgeTextColor?.({
      ...details,
      color: "#ffffff"
    });
  }

  return { count };
}

async function clearDisplayedMessageNoteIndicator(tab = null) {
  const actionApi = extensionApi.messageDisplayAction;
  if (!actionApi?.setTitle || !actionApi?.setBadgeText) {
    return;
  }

  const details = getMessageActionTabDetails(tab);
  await actionApi.setTitle({
    ...details,
    title: "Thunderbird Plus"
  });
  await actionApi.setBadgeText({
    ...details,
    text: ""
  });
}

function getMessageActionTabDetails(tab = null) {
  if (tab?.id !== undefined) {
    return { tabId: tab.id };
  }
  if (lastDisplayedMessageReference?.tabId != null) {
    return { tabId: lastDisplayedMessageReference.tabId };
  }
  return {};
}

async function openRelatedDisplayedMessageNotes(tab, source = {}) {
  const message = await resolveDisplayedMessage(tab, source);
  if (!message) {
    throw new Error("没有检测到当前邮件");
  }

  const notes = await findRelatedNotesForMessage(message);
  if (notes.length === 0) {
    throw new Error("这封邮件还没有关联备忘录");
  }

  if (notes.length === 1) {
    await openSavedNote(notes[0].id);
  } else {
    await openMessageNotes(message);
  }

  return { count: notes.length };
}

async function saveDisplayedMessageQuickNote(tab, source = {}) {
  const text = (source.text || "").trim();
  if (!text) {
    throw new Error("备注内容不能为空");
  }

  let message = null;
  try {
    message = await resolveDisplayedMessage(tab, source);
  } catch (error) {
    message = null;
  }

  const note = await createQuickNoteFromMessage(text, source.title, message);
  if (message) {
    await updateDisplayedMessageNoteIndicator(tab, message);
  }
  return note;
}

async function appendDisplayedMessageQuickNoteToCurrentNote(tab, source = {}) {
  const text = (source.text || "").trim();
  if (!text) {
    throw new Error("备注内容不能为空");
  }

  let message = null;
  try {
    message = await resolveDisplayedMessage(tab, source);
  } catch (error) {
    message = null;
  }

  const reference = message ? buildMessageReference(message, null) : null;
  const body = `
    <h3>快速备注 · ${formatNoteDateTime(new Date().toISOString())}</h3>
    ${reference ? buildMailReferenceHtml(reference) : ""}
    <p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>
  `;
  const note = await appendToCurrentNote(body, reference);
  if (message) {
    await updateDisplayedMessageNoteIndicator(tab, message);
  }
  return note;
}

async function resolveDisplayedMessage(tab, source = {}) {
  if (source.selectedMessages?.messages?.length > 0) {
    return source.selectedMessages.messages[0];
  }

  if (source.selectedMessages?.length > 0) {
    return source.selectedMessages[0];
  }

  if (tab?.id !== undefined && extensionApi.messageDisplay?.getDisplayedMessage) {
    const message = await extensionApi.messageDisplay.getDisplayedMessage(tab.id);
    if (message) {
      return message;
    }
  }

  if (extensionApi.messageDisplay?.getDisplayedMessage) {
    const message = await extensionApi.messageDisplay.getDisplayedMessage();
    if (message) {
      return message;
    }
  }

  if (lastDisplayedMessageReference?.id) {
    return lastDisplayedMessageReference;
  }

  return null;
}

async function createNoteFromMessage(message, textContent) {
  const reference = buildMessageReference(message, null);
  const excerpt = buildExcerpt(textContent, 1800);
  const body = `
    ${buildMailReferenceHtml(reference)}
    ${excerpt ? `<h3>邮件摘录</h3><p>${escapeHtml(excerpt).replace(/\n/g, "<br>")}</p>` : ""}
  `;

  return await saveNoteRecord({
    title: reference.subject || "邮件备忘录",
    body,
    bodyText: htmlToText(body),
    sourceMessageId: reference.id,
    sourceHeaderMessageId: reference.headerMessageId
  });
}

async function createChecklistNoteFromMessage(message, textContent) {
  const reference = buildMessageReference(message, null);
  const excerpt = buildExcerpt(textContent, 900);
  const subject = reference.subject || "无主题";
  const dateLine = reference.date ? `邮件日期：${formatNoteDateTime(reference.date)}` : "";
  const body = `
    ${buildMailReferenceHtml(reference)}
    <h3>待办清单</h3>
    <ul data-checklist="true">
      <li>阅读并确认邮件内容：${escapeHtml(subject)}</li>
      <li>判断是否需要回复 ${escapeHtml(reference.author || "发件人")}</li>
      <li>提取关键日期、金额、账号或附件信息</li>
      <li>处理完成后归档或标记邮件</li>
    </ul>
    ${dateLine ? `<p>${escapeHtml(dateLine)}</p>` : ""}
    ${excerpt ? `<h3>邮件摘录</h3><p>${escapeHtml(excerpt).replace(/\n/g, "<br>")}</p>` : ""}
  `;

  return await saveNoteRecord({
    title: `待办：${subject}`,
    body,
    bodyText: htmlToText(body),
    sourceMessageId: reference.id,
    sourceHeaderMessageId: reference.headerMessageId
  });
}

async function createSummaryNoteFromMessage(message, summaryText) {
  const reference = buildMessageReference(message, null);
  const body = `
    ${buildMailReferenceHtml(reference)}
    <h3>AI 总结</h3>
    ${summaryToHtml(summaryText)}
  `;

  return await saveNoteRecord({
    title: `总结：${reference.subject || "无主题"}`,
    body,
    bodyText: htmlToText(body),
    sourceMessageId: reference.id,
    sourceHeaderMessageId: reference.headerMessageId
  });
}

async function createQuickNoteFromMessage(text, title, message) {
  const reference = message ? buildMessageReference(message, null) : null;
  const firstLine = text.split(/\r?\n/u).map(line => line.trim()).find(Boolean) || "快速备注";
  const noteTitle = (title || firstLine || reference?.subject || "快速备注").trim().slice(0, 160);
  const body = `
    ${reference ? buildMailReferenceHtml(reference) : ""}
    <h3>快速备注</h3>
    <p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>
  `;

  return await saveNoteRecord({
    title: noteTitle,
    body,
    bodyText: htmlToText(body),
    sourceMessageId: reference?.id || null,
    sourceHeaderMessageId: reference?.headerMessageId || ""
  });
}

async function createNoteFromSelection(selectionText, message) {
  const reference = message ? buildMessageReference(message, null) : null;
  const firstLine = selectionText.split(/\r?\n/u).map(line => line.trim()).find(Boolean) || "选中文本";
  const title = firstLine.length > 42 ? `${firstLine.slice(0, 42)}...` : firstLine;
  const body = `
    ${reference ? buildMailReferenceHtml(reference) : ""}
    <h3>选中内容</h3>
    <blockquote>${escapeHtml(selectionText).replace(/\n/g, "<br>")}</blockquote>
  `;

  return await saveNoteRecord({
    title,
    body,
    bodyText: htmlToText(body),
    sourceMessageId: reference?.id || null,
    sourceHeaderMessageId: reference?.headerMessageId || ""
  });
}

function buildMailReferenceHtml(reference) {
  const lines = [
    reference.author ? `发件人：${reference.author}` : "",
    reference.recipients ? `收件人：${reference.recipients}` : "",
    reference.date ? `时间：${formatNoteDateTime(reference.date)}` : ""
  ].filter(Boolean);

  return `
    <blockquote data-mail-reference="true" data-message-id="${escapeHtml(String(reference.id || ""))}" data-header-message-id="${escapeHtml(reference.headerMessageId || "")}">
      <strong>邮件：${escapeHtml(reference.subject || "无主题")}</strong>
      <small>${escapeHtml(lines.join(" · "))}</small>
    </blockquote>
  `;
}

function buildExcerpt(text, maxChars) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trim()}...`;
}

function summaryToHtml(summaryText) {
  const lines = String(summaryText || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const html = [];
  let listType = null;

  const closeList = () => {
    if (!listType) {
      return;
    }
    html.push(listType === "checklist" ? "</ul>" : "</ul>");
    listType = null;
  };

  const openList = (type) => {
    if (listType === type) {
      return;
    }
    closeList();
    html.push(type === "checklist" ? '<ul data-checklist="true">' : "<ul>");
    listType = type;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.+)$/u);
    if (heading) {
      closeList();
      html.push(`<h3>${escapeHtml(heading[1])}</h3>`);
      continue;
    }

    const checklist = line.match(/^[-*]\s+\[[ xX]\]\s+(.+)$/u);
    if (checklist) {
      openList("checklist");
      html.push(`<li>${escapeHtml(checklist[1])}</li>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/u);
    if (bullet) {
      openList("bullet");
      html.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  return html.join("\n") || "<p>无摘要内容</p>";
}

async function findRelatedNotesForMessage(message) {
  const reference = buildMessageReference(message, null);
  const db = await openNotesDatabase();
  await ensureNotesDefaultFolder(db);

  const transaction = db.transaction("notes", "readonly");
  const notes = await requestToPromise(transaction.objectStore("notes").getAll());
  await transactionDone(transaction);
  db.close();

  return notes
    .filter(note => !note.deletedAt && noteMatchesMessage(note, reference))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

function noteMatchesMessage(note, reference) {
  const messageId = reference.id !== null && reference.id !== undefined ? String(reference.id) : "";
  const headerMessageId = reference.headerMessageId || "";

  if (messageId && String(note.sourceMessageId || "") === messageId) {
    return true;
  }

  if (headerMessageId && note.sourceHeaderMessageId === headerMessageId) {
    return true;
  }

  const body = note.body || "";
  return Boolean(
    (messageId && body.includes(`data-message-id="${escapeHtml(messageId)}"`)) ||
    (headerMessageId && body.includes(`data-header-message-id="${escapeHtml(headerMessageId)}"`))
  );
}

async function saveNoteRecord(fields) {
  const db = await openNotesDatabase();
  await ensureNotesDefaultFolder(db);

  const now = new Date().toISOString();
  const note = {
    id: createId("note"),
    title: (fields.title || "新建备忘录").trim().slice(0, 160),
    body: fields.body || "",
    bodyText: (fields.bodyText || "").slice(0, 20000),
    folderId: NOTES_DEFAULT_FOLDER_ID,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    sourceMessageId: fields.sourceMessageId || null,
    sourceHeaderMessageId: fields.sourceHeaderMessageId || ""
  };

  const transaction = db.transaction("notes", "readwrite");
  transaction.objectStore("notes").put(note);
  await transactionDone(transaction);
  db.close();
  return note;
}

async function appendToCurrentNote(bodyFragment, reference = null) {
  const current = await extensionApi.storage.local.get(["currentNoteId", "currentNoteTitle"]);
  if (!current.currentNoteId) {
    throw new Error("请先在备忘录中打开一条笔记");
  }

  const db = await openNotesDatabase();
  await ensureNotesDefaultFolder(db);

  const readTransaction = db.transaction("notes", "readonly");
  const note = await requestToPromise(
    readTransaction.objectStore("notes").get(current.currentNoteId)
  );
  await transactionDone(readTransaction);

  if (!note || note.deletedAt) {
    db.close();
    throw new Error("当前备忘录不存在或已删除");
  }

  const now = new Date().toISOString();
  const updatedBody = [
    note.body || "",
    "<p><br></p>",
    bodyFragment
  ].join("\n").trim();

  const updatedNote = {
    ...note,
    body: updatedBody,
    bodyText: htmlToText(updatedBody).slice(0, 20000),
    sourceMessageId: note.sourceMessageId || reference?.id || null,
    sourceHeaderMessageId: note.sourceHeaderMessageId || reference?.headerMessageId || "",
    updatedAt: now
  };

  const writeTransaction = db.transaction("notes", "readwrite");
  writeTransaction.objectStore("notes").put(updatedNote);
  await transactionDone(writeTransaction);
  db.close();
  return updatedNote;
}

function openNotesDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTES_DB_NAME, NOTES_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("notes")) {
        const notes = db.createObjectStore("notes", { keyPath: "id" });
        notes.createIndex("updatedAt", "updatedAt", { unique: false });
        notes.createIndex("folderId", "folderId", { unique: false });
        notes.createIndex("deletedAt", "deletedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("folders")) {
        const folders = db.createObjectStore("folders", { keyPath: "id" });
        folders.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function ensureNotesDefaultFolder(db) {
  const readTransaction = db.transaction("folders", "readonly");
  const existingFolder = await requestToPromise(
    readTransaction.objectStore("folders").get(NOTES_DEFAULT_FOLDER_ID)
  );
  await transactionDone(readTransaction);

  if (existingFolder) {
    return;
  }

  const now = new Date().toISOString();
  const writeTransaction = db.transaction("folders", "readwrite");
  writeTransaction.objectStore("folders").put({
    id: NOTES_DEFAULT_FOLDER_ID,
    name: "备忘录",
    createdAt: now,
    updatedAt: now
  });
  await transactionDone(writeTransaction);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openSavedNote(noteId) {
  const url = extensionApi.runtime.getURL(`notes/notes.html#note=${encodeURIComponent(noteId)}`);
  await extensionApi.tabs.create({ url });
}

async function openMessageNotes(message) {
  const reference = buildMessageReference(message, null);
  const hash = reference.headerMessageId
    ? `sourceHeader=${encodeURIComponent(reference.headerMessageId)}`
    : `sourceMessage=${encodeURIComponent(String(reference.id || ""))}`;
  const url = extensionApi.runtime.getURL(`notes/notes.html#${hash}`);
  await extensionApi.tabs.create({ url });
}

function formatNoteDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createId(prefix) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function registerNotesSpace() {
  if (!extensionApi.spacesToolbar?.addButton) {
    console.warn("Thunderbird spacesToolbar API is not available");
    return;
  }

  const { notesIcon } = await extensionApi.storage.local.get("notesIcon");

  const buttonProperties = {
    title: "备忘录",
    url: "notes/notes.html",
    defaultIcons: notesIcon || "icons/notes.svg"
  };

  try {
    await extensionApi.spacesToolbar.addButton("notes", buttonProperties);
  } catch (error) {
    if (extensionApi.spacesToolbar.updateButton) {
      await extensionApi.spacesToolbar.updateButton("notes", buttonProperties);
      return;
    }
    throw error;
  }
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

async function fetchOpenAIModels(apiUrl, apiKey) {
  const headers = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(buildApiUrl(apiUrl, "/models"), { headers });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const candidates = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];

  return candidates
    .map(model => typeof model === "string" ? model : model.id || model.name || model.model)
    .filter(Boolean);
}

async function fetchModels(provider, apiUrl, apiKey) {
  if (provider === "ollama") {
    const response = await fetch(buildApiUrl(apiUrl, "/api/tags"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return { models: data.models ? data.models.map(model => model.name) : [] };
  }

  if (provider === "volcano") {
    try {
      const apiModels = await fetchOpenAIModels(apiUrl, apiKey);
      const models = uniqueValues([...apiModels, ...VOLCANO_MODEL_PRESETS]);
      return {
        models,
        warning: apiModels.length > 0
          ? `API 返回 ${apiModels.length} 个模型，已合并官方 Chat API 模型清单`
          : "API 未返回模型，已加载官方 Chat API 模型清单"
      };
    } catch (error) {
      return {
        models: VOLCANO_MODEL_PRESETS,
        warning: `模型列表接口不可用，已加载官方 Chat API 模型清单；接口错误：${error.message}`
      };
    }
  }

  return { models: await fetchOpenAIModels(apiUrl, apiKey) };
}

async function testConnection(provider, apiUrl, apiKey, model) {
  let url;
  let options = {};

  if (provider === "ollama") {
    url = buildApiUrl(apiUrl, "/api/tags");
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }
    const data = await response.json();
    return { models: data.models ? data.models.map(item => item.name).filter(Boolean) : [] };
  } else if (provider === "google") {
    url = `${apiUrl}?key=${apiKey}&q=test&target=zh`;
    options.method = "POST";
  } else if (provider === "libretranslate") {
    url = buildApiUrl(apiUrl, "/languages");
  } else if (provider === "volcano") {
    return await fetchModels(provider, apiUrl, apiKey);
  } else if (provider === "aliyun" || provider === "custom") {
    try {
      return { models: await fetchOpenAIModels(apiUrl, apiKey) };
    } catch (error) {
      if (!model) {
        throw new Error(`模型列表获取失败，且未选择可测试模型：${error.message}`);
      }
      url = buildApiUrl(apiUrl, "/chat/completions");
      options.method = "POST";
      options.headers = { "Content-Type": "application/json" };
      if (apiKey) {
        options.headers.Authorization = `Bearer ${apiKey}`;
      }
      options.body = JSON.stringify({
        model: normalizeProviderModel(provider, model),
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0
      });
    }
  } else {
    if (!model) {
      throw new Error("请先填写模型名称");
    }
    url = buildApiUrl(apiUrl, "/chat/completions");
    options.method = "POST";
    options.headers = { "Content-Type": "application/json" };
    if (apiKey) {
      options.headers.Authorization = `Bearer ${apiKey}`;
    }
    options.body = JSON.stringify({
      model: normalizeProviderModel(provider, model),
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0
    });
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
  }
  return {};
}

async function translateDisplayedMessageInline(tab) {
  tab = await resolveActiveTab(tab);
  if (!tab?.id && tab?.id !== 0) {
    tab = lastDisplayedMessageReference?.tabId != null
      ? { id: lastDisplayedMessageReference.tabId }
      : null;
  }

  let message = null;
  if (tab?.id !== undefined && extensionApi.messageDisplay?.getDisplayedMessage) {
    try {
      message = await extensionApi.messageDisplay.getDisplayedMessage(tab.id);
    } catch (error) {
      message = null;
    }
  }

  if (!message && lastDisplayedMessageReference?.tabId != null) {
    tab = { id: lastDisplayedMessageReference.tabId };
    try {
      message = await extensionApi.messageDisplay.getDisplayedMessage(tab.id);
    } catch (error) {
      message = null;
    }
  }

  if (!message && extensionApi.messageDisplay?.getDisplayedMessage) {
    message = await extensionApi.messageDisplay.getDisplayedMessage();
  }

  if (!tab?.id && tab?.id !== 0) {
    throw new Error("没有可用的邮件标签页");
  }

  await showInlineTranslation(tab.id, {
    status: "loading",
    title: "邮件翻译",
    message: "正在读取邮件内容..."
  });

  if (!message) {
    throw new Error("没有检测到当前邮件");
  }

  const fullMessage = await extensionApi.messages.getFull(message.id);
  const textContent = extractTextContent(fullMessage);
  if (!textContent) {
    throw new Error("邮件正文为空，无法翻译");
  }

  const settings = await extensionApi.storage.local.get([
    "provider", "apiUrl", "apiKey", "model", "targetLang", "systemPrompt"
  ]);
  const provider = settings.provider || "volcano";
  const targetLang = settings.targetLang || "zh-CN";
  const model = normalizeProviderModel(
    provider,
    settings.model || (provider === "volcano" ? DEFAULT_TRANSLATION_MODEL : "")
  );

  await showInlineTranslation(tab.id, {
    status: "loading",
    title: "邮件翻译",
    meta: `${provider} / ${model || "默认模型"} -> ${LANG_NAMES[targetLang] || targetLang}`,
    message: "正在翻译..."
  });

  const translated = await translateText(textContent, {
    ...settings,
    provider,
    model,
    targetLang
  });

  await showInlineTranslation(tab.id, {
    status: "success",
    title: "邮件翻译",
    meta: `${provider} / ${model || "默认模型"} -> ${LANG_NAMES[targetLang] || targetLang}`,
    text: translated
  });
}

async function showInlineTranslation(tabId, payload) {
  await extensionApi.tabs.executeScript(tabId, {
    file: "translate/inline-inject.js"
  });

  return await extensionApi.tabs.sendMessage(tabId, {
    action: "showInlineTranslation",
    ...payload
  });
}

function extractTextContent(messagePart) {
  const parts = [];
  collectTextContent(messagePart, parts);
  return parts
    .join("\n\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectTextContent(messagePart, parts) {
  if (!messagePart) {
    return;
  }

  const contentType = (messagePart.contentType || "").toLowerCase();
  if (messagePart.body) {
    if (contentType.includes("text/html")) {
      const text = htmlToText(messagePart.body);
      if (text) {
        parts.push(text);
      }
    } else if (contentType.includes("text/plain") || !contentType) {
      const text = String(messagePart.body).trim();
      if (text) {
        parts.push(text);
      }
    }
  }

  if (Array.isArray(messagePart.parts)) {
    for (const part of messagePart.parts) {
      collectTextContent(part, parts);
    }
  }
}

function htmlToText(html) {
  const cleaned = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");

  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(cleaned, "text/html");
    return (doc.body?.innerText || doc.body?.textContent || "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  return cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function translateText(text, settings) {
  const provider = settings.provider || "volcano";
  const apiUrl = settings.apiUrl || "https://ark.cn-beijing.volces.com/api/v3";
  const apiKey = settings.apiKey || "";
  const model = normalizeProviderModel(provider, settings.model);
  const targetLang = settings.targetLang || "zh-CN";
  const systemPrompt = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const chunkSize = provider === "volcano" && isVolcanoTranslationModel(model) ? 1800 : 6000;
  const chunks = splitTextIntoChunks(text, chunkSize);
  const translatedChunks = [];

  for (const chunk of chunks) {
    if (provider === "ollama") {
      translatedChunks.push(await translateOllama(apiUrl, model || "llama3.1", systemPrompt, targetLang, chunk));
    } else if (provider === "volcano" && isVolcanoTranslationModel(model)) {
      translatedChunks.push(await translateVolcanoTranslation(apiUrl, apiKey, model, targetLang, chunk));
    } else if (provider === "volcano" || provider === "aliyun" || provider === "custom") {
      translatedChunks.push(await translateOpenAICompatible(apiUrl, apiKey, model, systemPrompt, targetLang, chunk));
    } else if (provider === "google") {
      translatedChunks.push(await translateGoogle(apiUrl, apiKey, chunk, targetLang));
    } else if (provider === "libretranslate") {
      translatedChunks.push(await translateLibreTranslate(apiUrl, apiKey, chunk, targetLang));
    } else {
      throw new Error(`不支持的翻译服务: ${provider}`);
    }
  }

  return translatedChunks.join("\n\n").trim();
}

async function summarizeText(text, reference, settings) {
  const provider = settings.provider || "volcano";
  if (provider === "google" || provider === "libretranslate") {
    throw new Error("当前服务只适合翻译；AI 总结请切换到 Ollama、火山方舟、阿里云或自定义 OpenAI 兼容接口");
  }

  const apiUrl = settings.apiUrl || (provider === "ollama" ? "http://localhost:11434" : "https://ark.cn-beijing.volces.com/api/v3");
  const apiKey = settings.apiKey || "";
  const configuredModel = normalizeProviderModel(provider, settings.model);
  const model = provider === "volcano" && isVolcanoTranslationModel(configuredModel)
    ? DEFAULT_SUMMARY_MODELS.volcano
    : configuredModel || DEFAULT_SUMMARY_MODELS[provider] || "";

  if (!model && provider !== "custom") {
    throw new Error("请先在设置中选择可用于总结的模型");
  }

  const sourceText = buildExcerpt(text, 12000);
  const systemPrompt = "你是邮件备忘录助手。请把邮件整理成简洁、可执行、适合保存到备忘录的中文笔记。不要编造邮件中没有的信息。";
  const userPrompt = [
    "请总结这封邮件，并严格按下面结构输出 Markdown：",
    "",
    "## 摘要",
    "- 2 到 4 条要点",
    "",
    "## 待办事项",
    "- [ ] 可执行事项；如果没有，请写 - [ ] 无明确待办",
    "",
    "## 关键日期/金额/账号",
    "- 如果没有，请写 - 无",
    "",
    "## 风险点",
    "- 如果没有，请写 - 无",
    "",
    `主题：${reference.subject || "无主题"}`,
    `发件人：${reference.author || "未知"}`,
    `收件人：${reference.recipients || "未知"}`,
    `时间：${reference.date ? formatNoteDateTime(reference.date) : "未知"}`,
    "",
    "邮件正文：",
    sourceText
  ].join("\n");

  if (provider === "ollama") {
    return await generateOllamaText(apiUrl, model || DEFAULT_SUMMARY_MODELS.ollama, systemPrompt, userPrompt);
  }

  return await generateOpenAICompatibleText(apiUrl, apiKey, model || "default", systemPrompt, userPrompt);
}

function splitTextIntoChunks(text, maxChars) {
  const normalized = String(text).replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const chunks = [];
  let rest = normalized;
  while (rest.length > maxChars) {
    let cutAt = rest.lastIndexOf("\n\n", maxChars);
    if (cutAt < maxChars * 0.45) {
      cutAt = rest.lastIndexOf("\n", maxChars);
    }
    if (cutAt < maxChars * 0.45) {
      cutAt = rest.lastIndexOf(". ", maxChars);
    }
    if (cutAt < maxChars * 0.45) {
      cutAt = rest.lastIndexOf(" ", maxChars);
    }
    if (cutAt < maxChars * 0.45) {
      cutAt = maxChars;
    }

    chunks.push(rest.slice(0, cutAt).trim());
    rest = rest.slice(cutAt).trim();
  }

  if (rest) {
    chunks.push(rest);
  }
  return chunks.filter(Boolean);
}

function isVolcanoTranslationModel(model) {
  return (model || "").startsWith("doubao-seed-translation");
}

function mapVolcanoTargetLang(targetLang) {
  return VOLCANO_TRANSLATION_LANGS[targetLang] || targetLang || "zh";
}

async function translateVolcanoTranslation(apiUrl, apiKey, model, targetLang, text) {
  if (!apiKey) {
    throw new Error("火山方舟 API 密钥不能为空");
  }

  const response = await fetch(buildApiUrl(apiUrl, "/responses"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_TRANSLATION_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text,
              translation_options: {
                target_language: mapVolcanoTargetLang(targetLang)
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`火山方舟 Responses API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  const translated = extractResponsesText(data);
  if (!translated) {
    throw new Error("火山方舟 Responses API 未返回译文");
  }
  return translated;
}

async function translateOpenAICompatible(apiUrl, apiKey, model, systemPrompt, targetLang, text) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(buildApiUrl(apiUrl, "/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || "default",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Translate to ${targetLang}:\n\n${text}` }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Chat API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || data.text || "";
}

async function generateOpenAICompatibleText(apiUrl, apiKey, model, systemPrompt, userPrompt) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(buildApiUrl(apiUrl, "/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || "default",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Chat API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || data.text || "";
}

async function translateOllama(apiUrl, model, systemPrompt, targetLang, text) {
  const response = await fetch(buildApiUrl(apiUrl, "/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "llama3.1",
      prompt: `${systemPrompt}\n\nTranslate to ${targetLang}:\n\n${text}`,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Ollama API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data.response || data.text || "";
}

async function generateOllamaText(apiUrl, model, systemPrompt, userPrompt) {
  const response = await fetch(buildApiUrl(apiUrl, "/api/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || DEFAULT_SUMMARY_MODELS.ollama,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Ollama API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data.response || data.text || "";
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
    const errorText = await response.text().catch(() => "");
    throw new Error(`Google Translate API 错误 (${response.status}): ${errorText || response.statusText}`);
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
    const errorText = await response.text().catch(() => "");
    throw new Error(`LibreTranslate API 错误 (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data.translatedText || "";
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  const parts = [];
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content.text === "string") {
            parts.push(content.text);
          } else if (typeof content.output_text === "string") {
            parts.push(content.output_text);
          }
        }
      }
    }
  }

  if (parts.length > 0) {
    return parts.join("").trim();
  }

  return data?.choices?.[0]?.message?.content || data?.text || "";
}
