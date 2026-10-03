const extensionApi = globalThis.messenger || globalThis.browser;
const PAGE_SIZE = 50;
const BULK_READ_BATCH_SIZE = 20;

const messageListEl = document.getElementById("messages");
const summaryEl = document.getElementById("summary");
const emptyEl = document.getElementById("empty");
const errorEl = document.getElementById("error");
const activityStatusEl = document.getElementById("activity-status");
const accountFilterEl = document.getElementById("account-filter");
const folderFilterEl = document.getElementById("folder-filter");
const searchEl = document.getElementById("search");
const sortOrderEl = document.getElementById("sort-order");
const starredOnlyEl = document.getElementById("starred-only");
const selectVisibleEl = document.getElementById("select-visible");
const selectionCountEl = document.getElementById("selection-count");
const markSelectedReadButton = document.getElementById("mark-selected-read");
const markAllReadButton = document.getElementById("mark-all-read");
const allReadConfirmationEl = document.getElementById("all-read-confirmation");
const allReadMessageEl = document.getElementById("all-read-message");
const cancelAllReadButton = document.getElementById("cancel-all-read");
const confirmAllReadButton = document.getElementById("confirm-all-read");
const loadMoreButton = document.getElementById("load-more");
const refreshButton = document.getElementById("refresh");
const settingsButton = document.getElementById("settings");
const toggleAllGroupsButton = document.getElementById("toggle-all-groups");

let messages = [];
let loadedMessageIds = new Set();
let selectedMessageIds = new Set();
let accounts = new Map();
let messageListId = null;
let loading = false;
let preparingAllRead = false;
let bulkActionInProgress = false;
let hasMore = false;
let pendingAllReadIds = null;
let activityMessage = "";
let globalUnreadTotal = null;
let panelPort = null;
// Keys of collapsed groups. Absence means "expanded", so newly appearing
// accounts are shown open by default. Keys come from accountStorageKey() — the
// account email address where available — so they stay valid across restarts
// even when account ids change shape or order. Persisted to storage.local.
const collapsedAccountIds = new Set();
const GROUPED_SORT_ORDER = "account";
const COLLAPSED_STORAGE_KEY = "unreadCollapsedAccountIds";
// View preferences (sort order, filters, search term, starred-only). Persisted
// so reopening the popup keeps the way the user last had the list arranged.
const VIEW_STORAGE_KEY = "unreadViewPreferences";
// folder.id (as String) -> account. Rebuilt whenever the account list loads;
// this is how we map a message back to its account reliably.
let folderToAccountIndex = new Map();
let viewPreferencesLoaded = false;
// Saved account filter, held until the account dropdown is populated.
let pendingAccountId = null;
// Saved folder filter, held until the folder dropdown is repopulated.
let pendingFolderId = null;

const collator = new Intl.Collator("zh-CN", { sensitivity: "base", numeric: true });

function setError(message = "") {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setActivity(message = "") {
  activityMessage = message;
  activityStatusEl.textContent = message;
  activityStatusEl.hidden = !message;
}

function messageAccountId(message) {
  return message.folder?.accountId || message.accountId || "";
}

// Thunderbird exposes an account id in more than one shape: accounts.list()
// returns a string id (e.g. "account1") while message.folder.accountId can be a
// numeric internal id (e.g. 1). There is no reliable way to convert one into the
// other, so we never try. Instead we resolve an account by the folder it owns,
// which both sides agree on via String(folder.id), and fall back to the plain id
// lookup when that fails.
function buildFolderToAccountIndex() {
  const index = new Map();
  for (const account of accounts.values()) {
    for (const folder of account.folders || []) {
      if (folder.id === undefined || folder.id === null) continue;
      const key = String(folder.id);
      if (!index.has(key)) index.set(key, account);
    }
  }
  return index;
}

function findAccount(accountId, folder = null) {
  // 1) Direct lookup, tolerating the id being a number in one place and a
  //    string in the other.
  if (accountId !== undefined && accountId !== null && accountId !== "") {
    const direct = accounts.get(accountId);
    if (direct) return direct;
    const wanted = String(accountId);
    for (const [key, account] of accounts) {
      if (String(key) === wanted) return account;
      if (account?.id !== undefined && String(account.id) === wanted) return account;
    }
  }

  // 2) Resolve through the folder, which is the only identifier that matches
  //    across accounts.list() and the message objects.
  if (folder?.id !== undefined && folder?.id !== null) {
    const owner = folderToAccountIndex.get(String(folder.id));
    if (owner) return owner;
  }

  return null;
}

function accountEmail(accountId, folder) {
  const account = findAccount(accountId, folder);
  return account?.identities?.[0]?.email || "";
}

// Stable identity for persisted collapse state. The email address survives
// account reordering and id shape changes; the folder id is the fallback, and
// the raw account id only after that.
function accountStorageKey(accountId, folder) {
  const email = accountEmail(accountId, folder);
  if (email) return `email:${email.toLowerCase()}`;
  if (folder?.id !== undefined && folder?.id !== null) {
    return `folder:${String(folder.id)}`;
  }
  const id = accountId || folder?.accountId;
  return id === undefined || id === null || id === ""
    ? "unknown"
    : `id:${String(id)}`;
}

function accountLabel(accountId, folder) {
  const account = findAccount(accountId, folder);
  const email = account?.identities?.[0]?.email;
  const name = account?.name;

  if (name && email) {
    // Some accounts have name === email address; don't print it twice.
    return name.toLowerCase() === email.toLowerCase() ? email : `${name} · ${email}`;
  }
  if (name) return name;
  if (email) return email;
  const id = accountId || folder?.accountId;
  return id ? String(id) : "未知邮箱";
}

function folderKey(folder) {
  if (!folder) return "";
  return folder.id !== undefined && folder.id !== null
    ? String(folder.id)
    : `${folder.accountId || ""}\u001f${folder.path || folder.name || ""}`;
}

function folderLabel(folder) {
  const name = folder?.name || folder?.path || "未知文件夹";
  const accountId = folder?.accountId;
  return accountId ? `${accountLabel(accountId, folder)} / ${name}` : name;
}

function dateTimestamp(date) {
  const timestamp = new Date(date || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dateLabel(date) {
  if (!date) return "";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(value);
}

// Resolve which account a message belongs to, preferring the folder index
// because folder ids are the one identifier both APIs agree on.
function resolveAccountId(message) {
  const owner = findAccount(messageAccountId(message), message.folder);
  return owner?.id !== undefined ? String(owner.id) : String(messageAccountId(message));
}

function getVisibleMessages() {
  const selectedAccountId = accountFilterEl.value;
  const selectedFolderId = folderFilterEl.value;
  const query = searchEl.value.trim().toLocaleLowerCase("zh-CN");

  const visible = messages.filter(message => {
    // Compare resolved account ids: the filter's value comes from
    // accounts.list() while the message carries whatever shape Thunderbird
    // used for that folder, so a raw comparison can silently drop matches.
    if (selectedAccountId && resolveAccountId(message) !== String(selectedAccountId)) return false;
    if (selectedFolderId && folderKey(message.folder) !== selectedFolderId) return false;
    if (starredOnlyEl.checked && !message.flagged) return false;
    if (!query) return true;

    const searchable = [
      message.author,
      message.subject,
      accountLabel(messageAccountId(message), message.folder),
      message.folder?.name,
      message.folder?.path
    ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
    return searchable.includes(query);
  });

  const sortOrder = sortOrderEl.value;
  visible.sort((left, right) => {
    switch (sortOrder) {
      case "oldest":
        return dateTimestamp(left.date) - dateTimestamp(right.date);
      case "sender":
        return collator.compare(left.author || "", right.author || "");
      case "subject":
        return collator.compare(left.subject || "", right.subject || "");
      case "account":
        return collator.compare(
          accountLabel(messageAccountId(left), left.folder),
          accountLabel(messageAccountId(right), right.folder)
        );
      case "newest":
      default:
        return dateTimestamp(right.date) - dateTimestamp(left.date);
    }
  });
  return visible;
}

function updateFolderOptions() {
  const selectedAccountId = accountFilterEl.value;
  const previousValue = folderFilterEl.value;
  const folders = new Map();

  for (const message of messages) {
    const folder = message.folder;
    if (!folder || (selectedAccountId && resolveAccountId(message) !== String(selectedAccountId))) continue;
    const id = folderKey(folder);
    if (id) folders.set(id, { id, label: folderLabel(folder) });
  }

  const options = [...folders.values()].sort((left, right) => collator.compare(left.label, right.label));
  folderFilterEl.replaceChildren();
  const allFolders = document.createElement("option");
  allFolders.value = "";
  allFolders.textContent = "所有文件夹";
  folderFilterEl.appendChild(allFolders);
  for (const folder of options) {
    const option = document.createElement("option");
    option.value = folder.id;
    option.textContent = folder.label;
    folderFilterEl.appendChild(option);
  }

  // A restored preference wins over the live selection. Only clear the pending
  // value once the folder actually shows up: on the first render the list may
  // hold just the first page, and dropping it there would lose the preference.
  let desired = previousValue;
  if (pendingFolderId !== null) {
    if (folders.has(pendingFolderId)) {
      desired = pendingFolderId;
      pendingFolderId = null;
    } else if (previousValue) {
      // Fall through to the live selection while still waiting for the folder
      // to page in; keep pendingFolderId so a later render can apply it.
      desired = previousValue;
    } else {
      desired = "";
    }
  }
  folderFilterEl.value = desired && folders.has(desired) ? desired : "";
}

// Grouping is only meaningful when the list is ordered by account; under any
// other sort order the same account's messages are interleaved, so we fall
// back to a flat list instead of emitting a header before every message.
function isGroupedView() {
  return sortOrderEl.value === GROUPED_SORT_ORDER;
}

async function loadCollapsedState() {
  try {
    const stored = await extensionApi.storage?.local?.get?.(COLLAPSED_STORAGE_KEY);
    const ids = stored?.[COLLAPSED_STORAGE_KEY];
    if (!Array.isArray(ids)) return;
    collapsedAccountIds.clear();
    for (const id of ids) {
      if (typeof id === "string" && id) collapsedAccountIds.add(id);
    }
  } catch (error) {
    console.warn("Load collapsed groups failed:", error);
  }
}

function saveCollapsedState() {
  // Fire-and-forget: the UI already reflects the change, and a failed write
  // only costs the user their collapse state on next open.
  extensionApi.storage?.local
    ?.set?.({ [COLLAPSED_STORAGE_KEY]: [...collapsedAccountIds] })
    ?.catch?.(error => console.warn("Save collapsed groups failed:", error));
}

function readViewPreferences() {
  return {
    sortOrder: sortOrderEl.value,
    starredOnly: starredOnlyEl.checked,
    search: searchEl.value,
    accountId: accountFilterEl.value,
    folderId: folderFilterEl.value
  };
}

function saveViewPreferences() {
  // Guarded by viewPreferencesLoaded so the initial render cannot overwrite the
  // stored preferences with the defaults before they have been restored.
  if (!viewPreferencesLoaded) return;
  extensionApi.storage?.local
    ?.set?.({ [VIEW_STORAGE_KEY]: readViewPreferences() })
    ?.catch?.(error => console.warn("Save view preferences failed:", error));
}

async function loadViewPreferences() {
  try {
    const stored = await extensionApi.storage?.local?.get?.(VIEW_STORAGE_KEY);
    const prefs = stored?.[VIEW_STORAGE_KEY];
    if (!prefs || typeof prefs !== "object") return;

    if (typeof prefs.sortOrder === "string" &&
        [...sortOrderEl.options].some(o => o.value === prefs.sortOrder)) {
      sortOrderEl.value = prefs.sortOrder;
    }
    if (typeof prefs.starredOnly === "boolean") {
      starredOnlyEl.checked = prefs.starredOnly;
    }
    if (typeof prefs.search === "string") {
      searchEl.value = prefs.search;
    }
    // The account may no longer exist; loadAccounts() decides whether to apply
    // this once it has populated the dropdown.
    if (typeof prefs.accountId === "string") {
      pendingAccountId = prefs.accountId;
    }
    // Likewise for the folder, which is rebuilt from the loaded message list.
    if (typeof prefs.folderId === "string") {
      pendingFolderId = prefs.folderId;
    }
  } catch (error) {
    console.warn("Load view preferences failed:", error);
  }
}

function groupMessagesByAccount(visibleMessages) {
  const groups = new Map();
  for (const message of visibleMessages) {
    const accountId = messageAccountId(message);
    // Key by the stable storage key, not the raw id, so a group stays the same
    // group across id shape changes and reordering.
    const key = accountStorageKey(accountId, message.folder);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        accountId,
        label: accountLabel(accountId, message.folder),
        messages: []
      });
    }
    groups.get(key).messages.push(message);
  }
  return [...groups.values()];
}

// Lucide chevron paths, kept as markup so the group header matches the
// stroke icons in the toolbar instead of mixing in a font-rendered glyph.
const CHEVRON_PATHS = {
  collapsed: "m9 18 6-6-6-6",
  expanded: "m6 9 6 6 6-6"
};

function createChevronIcon(collapsed) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", collapsed ? CHEVRON_PATHS.collapsed : CHEVRON_PATHS.expanded);
  svg.appendChild(path);
  return svg;
}

function createGroupHeader(group) {
  const collapsed = collapsedAccountIds.has(group.key);

  const header = document.createElement("button");
  header.className = "group-header";
  header.type = "button";
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.setAttribute(
    "aria-label",
    `${collapsed ? "展开" : "收起"}${group.label}，共 ${group.messages.length} 封未读`
  );

  const chevron = document.createElement("span");
  chevron.className = "group-chevron";
  chevron.appendChild(createChevronIcon(collapsed));

  const label = document.createElement("span");
  label.className = "group-label";
  label.textContent = group.label;

  const count = document.createElement("span");
  count.className = "group-count";
  count.textContent = `${group.messages.length} 封`;

  header.append(chevron, label, count);
  header.addEventListener("click", () => {
    if (collapsedAccountIds.has(group.key)) {
      collapsedAccountIds.delete(group.key);
    } else {
      collapsedAccountIds.add(group.key);
    }
    saveCollapsedState();
    render();
  });
  return header;
}

function createMessageItem(message, busy) {
  const item = document.createElement("article");
  item.className = "mail-item";

  const selectionLabel = document.createElement("label");
  selectionLabel.className = "mail-select-label";
  const selectionCheckbox = document.createElement("input");
  selectionCheckbox.className = "mail-select";
  selectionCheckbox.type = "checkbox";
  selectionCheckbox.checked = selectedMessageIds.has(message.id);
  selectionCheckbox.disabled = busy;
  selectionCheckbox.setAttribute("aria-label", `选择邮件：${message.subject || "无主题"}`);
  selectionCheckbox.addEventListener("change", () => {
    if (selectionCheckbox.checked) selectedMessageIds.add(message.id);
    else selectedMessageIds.delete(message.id);
    render();
  });
  selectionLabel.appendChild(selectionCheckbox);

  const openButton = document.createElement("button");
  openButton.className = "mail-open";
  openButton.type = "button";
  openButton.disabled = busy;
  openButton.setAttribute("aria-label", `打开邮件：${message.subject || "无主题"}`);

  const topLine = document.createElement("span");
  topLine.className = "mail-topline";
  const sender = document.createElement("span");
  sender.className = "mail-sender";
  sender.textContent = message.author || "未知发件人";
  const date = document.createElement("time");
  date.className = "mail-date";
  date.textContent = dateLabel(message.date);
  topLine.append(sender, date);

  const subject = document.createElement("span");
  subject.className = "mail-subject";
  subject.textContent = message.subject || "（无主题）";

  const meta = document.createElement("span");
  meta.className = "mail-meta";
  const account = document.createElement("span");
  account.className = "mail-account";
  account.textContent = accountLabel(messageAccountId(message), message.folder);
  const folder = document.createElement("span");
  folder.className = "mail-folder";
  folder.textContent = message.folder?.name || "";
  meta.append(account, folder);
  openButton.append(topLine, subject, meta);
  openButton.addEventListener("click", () => openMessage(message, openButton));

  const readButton = document.createElement("button");
  readButton.className = "read-button";
  readButton.type = "button";
  readButton.textContent = "标为已读";
  readButton.disabled = busy;
  readButton.setAttribute("aria-label", `将邮件标为已读：${message.subject || "无主题"}`);
  readButton.addEventListener("click", () => markMessagesRead([message.id]));

  item.append(selectionLabel, openButton, readButton);
  return item;
}

function render() {
  updateFolderOptions();
  const visibleMessages = getVisibleMessages();
  const busy = loading || preparingAllRead || bulkActionInProgress;
  const grouped = isGroupedView();
  const groups = grouped ? groupMessagesByAccount(visibleMessages) : [];
  // Only count groups that are actually present in the current filtered list,
  // so the hint never mentions an account the user has filtered away.
  let collapsedCount = 0;
  for (const group of groups) {
    if (collapsedAccountIds.has(group.key)) collapsedCount += group.messages.length;
  }

  messageListEl.replaceChildren();

  if (grouped) {
    messageListEl.classList.add("is-grouped");
    for (const group of groups) {
      messageListEl.appendChild(createGroupHeader(group));
      if (collapsedAccountIds.has(group.key)) continue;
      const body = document.createElement("div");
      body.className = "group-body";
      for (const message of group.messages) {
        body.appendChild(createMessageItem(message, busy));
      }
      messageListEl.appendChild(body);
    }
  } else {
    messageListEl.classList.remove("is-grouped");
    for (const message of visibleMessages) {
      messageListEl.appendChild(createMessageItem(message, busy));
    }
  }

  summaryEl.textContent = buildSummaryText(visibleMessages.length, hasMore, collapsedCount);
  emptyEl.hidden = visibleMessages.length !== 0;
  emptyEl.textContent = messages.length === 0
    ? "所有邮箱当前没有未读邮件。"
    : "没有符合当前筛选条件的未读邮件。";

  // The master toggle only makes sense while grouped and with more than one
  // account in play; with a single group it would just mirror that header.
  const allGroupsCollapsed = groups.length > 0 && groups.every(g => collapsedAccountIds.has(g.key));
  toggleAllGroupsButton.hidden = !grouped || groups.length < 2;
  toggleAllGroupsButton.textContent = allGroupsCollapsed ? "全部展开" : "全部收起";
  toggleAllGroupsButton.disabled = busy;

  const selectedVisibleCount = visibleMessages.filter(message => selectedMessageIds.has(message.id)).length;
  selectVisibleEl.checked = visibleMessages.length > 0 && selectedVisibleCount === visibleMessages.length;
  selectVisibleEl.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleMessages.length;
  selectVisibleEl.disabled = visibleMessages.length === 0 || bulkActionInProgress;
  selectionCountEl.textContent = selectedMessageIds.size ? `已选 ${selectedMessageIds.size} 封` : "未选择";
  markSelectedReadButton.disabled = selectedMessageIds.size === 0 || busy;
  markAllReadButton.disabled = busy || pendingAllReadIds !== null;
  loadMoreButton.hidden = !hasMore;
  loadMoreButton.disabled = busy;
  refreshButton.disabled = busy;
  for (const control of [accountFilterEl, folderFilterEl, searchEl, sortOrderEl, starredOnlyEl]) {
    control.disabled = busy;
  }
  activityStatusEl.textContent = activityMessage;
  activityStatusEl.hidden = !activityMessage;
}

function normalizePage(page) {
  if (typeof page === "string") return { id: page, messages: [] };
  return page || { id: null, messages: [] };
}

function addPageMessages(page) {
  for (const message of page.messages || []) {
    if (message.read === true || loadedMessageIds.has(message.id)) continue;
    messages.push(message);
    loadedMessageIds.add(message.id);
  }
}

async function appendNextPage() {
  if (loading || preparingAllRead || bulkActionInProgress) return;
  loading = true;
  setError();
  render();

  try {
    const page = normalizePage(messageListId
      ? await extensionApi.messages.continueList(messageListId)
      : await extensionApi.messages.query({
        unread: true,
        messagesPerPage: PAGE_SIZE,
        autoPaginationTimeout: 500
      }));
    messageListId = page.id || null;
    addPageMessages(page);
    hasMore = Boolean(messageListId);
  } catch (error) {
    hasMore = Boolean(messageListId);
    setError(`读取未读邮件失败：${error.message || error}`);
  } finally {
    loading = false;
    render();
  }
}

async function refreshMessages() {
  if (loading || preparingAllRead || bulkActionInProgress) return;
  pendingAllReadIds = null;
  allReadConfirmationEl.hidden = true;
  if (messageListId && extensionApi.messages.abortList) {
    extensionApi.messages.abortList(messageListId).catch(() => {});
  }
  messages = [];
  loadedMessageIds = new Set();
  selectedMessageIds.clear();
  messageListId = null;
  hasMore = false;
  await appendNextPage();
}

async function collectAllUnreadIds() {
  const ids = [];
  const seen = new Set();
  let page = normalizePage(await extensionApi.messages.query({
    unread: true,
    messagesPerPage: 100,
    autoPaginationTimeout: 500
  }));
  let activeListId = page.id || null;

  try {
    while (true) {
      for (const message of page.messages || []) {
        if (message.read !== true && !seen.has(message.id)) {
          seen.add(message.id);
          ids.push(message.id);
        }
      }
      if (!page.id) break;
      activeListId = page.id;
      page = normalizePage(await extensionApi.messages.continueList(activeListId));
      activeListId = page.id || null;
      setActivity(`正在统计未读邮件：已找到 ${ids.length} 封…`);
    }
  } catch (error) {
    if (activeListId && extensionApi.messages.abortList) {
      extensionApi.messages.abortList(activeListId).catch(() => {});
    }
    throw error;
  }
  return ids;
}

async function prepareAllRead() {
  if (loading || preparingAllRead || bulkActionInProgress) return;
  preparingAllRead = true;
  pendingAllReadIds = null;
  allReadConfirmationEl.hidden = true;
  setError();
  setActivity("正在统计所有账号的未读邮件…");
  render();

  try {
    const ids = await collectAllUnreadIds();
    if (!ids.length) {
      setActivity("所有账号目前没有未读邮件。");
      return;
    }
    pendingAllReadIds = ids;
    allReadMessageEl.textContent = `将在所有账号和文件夹中把 ${ids.length} 封未读邮件标记为已读。`;
    allReadConfirmationEl.hidden = false;
    setActivity("");
  } catch (error) {
    setError(`统计未读邮件失败：${error.message || error}`);
    setActivity("");
  } finally {
    preparingAllRead = false;
    render();
  }
}

async function markMessagesRead(ids, { refreshAfter = false } = {}) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length || bulkActionInProgress) return;

  bulkActionInProgress = true;
  setError();
  const updatedIds = [];
  const failedIds = [];
  render();

  try {
    for (let start = 0; start < uniqueIds.length; start += BULK_READ_BATCH_SIZE) {
      const batch = uniqueIds.slice(start, start + BULK_READ_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(id => extensionApi.messages.update(id, { read: true }))
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          updatedIds.push(batch[index]);
          loadedMessageIds.add(batch[index]);
        } else {
          failedIds.push(batch[index]);
        }
      });

      const completed = updatedIds.length + failedIds.length;
      setActivity(`正在标记已读：${completed} / ${uniqueIds.length}`);
      render();
    }
  } finally {
    const updated = new Set(updatedIds);
    messages = messages.filter(message => !updated.has(message.id));
    for (const id of updatedIds) selectedMessageIds.delete(id);
    bulkActionInProgress = false;
    setActivity("");
    render();
  }

  if (refreshAfter) {
    await refreshMessages();
  }
  if (failedIds.length) {
    setError(`${updatedIds.length} 封已标记为已读，${failedIds.length} 封失败。刷新后可重试。`);
  }
}

async function openMessage(message, button) {
  button.disabled = true;
  setError();
  let updateError = null;
  try {
    await extensionApi.messages.update(message.id, { read: true });
    messages = messages.filter(item => item.id !== message.id);
    selectedMessageIds.delete(message.id);
    render();
  } catch (error) {
    updateError = error;
  }

  try {
    await extensionApi.messageDisplay.open({
      messageId: message.id,
      location: "tab",
      active: true
    });
    if (updateError) {
      setError(`邮件已打开，但同步已读状态失败：${updateError.message || updateError}`);
    }
  } catch (error) {
    setError(`打开邮件失败：${error.message || error}`);
    button.disabled = false;
    refreshMessages();
  }
}

async function loadAccounts() {
  if (!extensionApi.accounts?.list) return;
  const listedAccounts = await extensionApi.accounts.list();
  accounts = new Map(listedAccounts.map(account => [account.id, account]));
  folderToAccountIndex = buildFolderToAccountIndex();

  // Rebuild from scratch so a repeated call cannot duplicate options.
  const previousValue = accountFilterEl.value;
  accountFilterEl.replaceChildren();
  const allAccounts = document.createElement("option");
  allAccounts.value = "";
  allAccounts.textContent = "所有账号";
  accountFilterEl.appendChild(allAccounts);

  for (const account of listedAccounts) {
    const option = document.createElement("option");
    option.value = account.id;
    const email = account.identities?.[0]?.email;
    option.textContent = account.name && email
      ? `${account.name} (${email})`
      : account.name || email || account.id;
    accountFilterEl.appendChild(option);
  }

  // Prefer a restored preference over the current selection; fall back to the
  // current value, and drop either if that account is gone.
  const desired = pendingAccountId !== null ? pendingAccountId : previousValue;
  pendingAccountId = null;
  if (desired && accounts.has(desired)) {
    accountFilterEl.value = desired;
  } else {
    accountFilterEl.value = "";
  }
}

extensionApi.messages.onUpdated?.addListener((message, changedProperties = {}) => {
  const index = messages.findIndex(item => item.id === message.id);
  if (changedProperties.read === true) {
    messages = messages.filter(item => item.id !== message.id);
    selectedMessageIds.delete(message.id);
  } else if (index >= 0) {
    messages[index] = { ...messages[index], ...message };
  } else if (message.read === false) {
    messages.push(message);
    loadedMessageIds.add(message.id);
  }
  if (!bulkActionInProgress) render();
});

extensionApi.messages.onNewMailReceived?.addListener((folder, page) => {
  for (const message of page?.messages || []) {
    if (message.read !== false) continue;
    const existingIndex = messages.findIndex(item => item.id === message.id);
    if (existingIndex >= 0) messages[existingIndex] = { ...messages[existingIndex], ...message, folder: message.folder || folder };
    else messages.push({ ...message, folder: message.folder || folder });
    loadedMessageIds.add(message.id);
  }
  render();
}, true);

function buildSummaryText(visibleCount, morePages, collapsedCount = 0) {
  // The toolbar tooltip follows the global unfiltered total; the summary shows
  // both numbers so a filtered list is never mistaken for the whole mailbox.
  // "筛选" is the filter result size and "已折叠" says how many of those are
  // hidden by collapse — the two are orthogonal, so they stay separate.
  if (!Number.isFinite(globalUnreadTotal)) {
    const fallback = `${visibleCount} 封符合条件 · 已加载 ${messages.length} 封未读邮件`;
    return collapsedCount > 0
      ? `${fallback} · 已折叠 ${collapsedCount} 封${morePages ? " · 还有更多" : ""}`
      : `${fallback}${morePages ? " · 还有更多" : ""}`;
  }

  const parts = [
    `全部未读 ${globalUnreadTotal} 封`,
    `当前筛选 ${visibleCount} 封`,
    `已加载 ${messages.length} 封`
  ];
  if (collapsedCount > 0) parts.push(`已折叠 ${collapsedCount} 封`);
  if (morePages) parts.push("还有更多");
  return parts.join(" · ");
}

function setGlobalUnreadTotal(total) {
  if (!Number.isFinite(total)) return;
  if (total === globalUnreadTotal) return;
  globalUnreadTotal = total;
  render();
}

function connectUnreadPanelPort() {
  if (!extensionApi.runtime?.connect) return;

  try {
    panelPort = extensionApi.runtime.connect({ name: "unread-panel" });
  } catch (error) {
    console.warn("Unread panel port unavailable:", error);
    return;
  }

  panelPort.onMessage?.addListener(message => {
    if (message?.action === "unreadBadgeTotal") setGlobalUnreadTotal(message.total);
  });
}

async function requestGlobalUnreadTotal() {
  if (!extensionApi.runtime?.sendMessage) return;
  try {
    const response = await extensionApi.runtime.sendMessage({ action: "getUnreadBadgeTotal" });
    if (response?.success) setGlobalUnreadTotal(response.total);
  } catch (error) {
    console.warn("Load global unread total failed:", error);
  }
}

loadMoreButton.addEventListener("click", appendNextPage);
refreshButton.addEventListener("click", refreshMessages);
markAllReadButton.addEventListener("click", prepareAllRead);
toggleAllGroupsButton.addEventListener("click", () => {
  const groups = groupMessagesByAccount(getVisibleMessages());
  if (!groups.length) return;

  // If every visible group is already collapsed, expand all; otherwise
  // collapse all. Collapsing clears the set, so groups not currently visible
  // (filtered out, or not yet paged in) keep whatever state they had.
  const allCollapsed = groups.every(group => collapsedAccountIds.has(group.key));
  if (allCollapsed) {
    for (const group of groups) collapsedAccountIds.delete(group.key);
  } else {
    for (const group of groups) collapsedAccountIds.add(group.key);
  }
  saveCollapsedState();
  render();
});
markSelectedReadButton.addEventListener("click", () => markMessagesRead([...selectedMessageIds]));
cancelAllReadButton.addEventListener("click", () => {
  pendingAllReadIds = null;
  allReadConfirmationEl.hidden = true;
  render();
});
confirmAllReadButton.addEventListener("click", async () => {
  const ids = pendingAllReadIds;
  pendingAllReadIds = null;
  allReadConfirmationEl.hidden = true;
  await markMessagesRead(ids || [], { refreshAfter: true });
});
selectVisibleEl.addEventListener("change", () => {
  const visibleMessages = getVisibleMessages();
  for (const message of visibleMessages) {
    if (selectVisibleEl.checked) selectedMessageIds.add(message.id);
    else selectedMessageIds.delete(message.id);
  }
  render();
});
for (const control of [accountFilterEl, folderFilterEl, sortOrderEl, starredOnlyEl]) {
  control.addEventListener("change", () => {
    saveViewPreferences();
    render();
  });
}
searchEl.addEventListener("input", () => {
  saveViewPreferences();
  render();
});
settingsButton.addEventListener("click", () => {
  if (extensionApi.runtime.openOptionsPage) {
    extensionApi.runtime.openOptionsPage();
  } else {
    extensionApi.tabs.create({ url: extensionApi.runtime.getURL("options/options.html") });
  }
});

(async () => {
  try {
    connectUnreadPanelPort();
    requestGlobalUnreadTotal();
    await loadViewPreferences();
    await loadCollapsedState();
    await loadAccounts();
    // Only now arm the save hook: everything above ran with restored values,
    // so the first render no longer risks persisting defaults over them.
    viewPreferencesLoaded = true;
    await appendNextPage();
  } catch (error) {
    setError(`初始化邮箱列表失败：${error.message || error}`);
    summaryEl.textContent = "未能读取邮箱信息";
    viewPreferencesLoaded = true;
  }
})();
