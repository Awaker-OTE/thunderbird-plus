import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const addon = resolve(workspace, "thunderbird-interaction-enhancer");
const manifest = JSON.parse(readFileSync(resolve(addon, "manifest.json"), "utf8"));
const popupPath = manifest.browser_action?.default_popup;

assert.equal(popupPath, "unread/unread.html", "toolbar action must open the unread panel");
assert.ok(existsSync(resolve(addon, popupPath)), "toolbar popup file must exist");
for (const permission of ["messagesRead", "messagesUpdate", "accountsRead"]) {
  assert.ok(manifest.permissions.includes(permission), `missing ${permission} permission`);
}
assert.ok(!manifest.permissions.includes("mailTabs"), "mailTabs is an API name, not a manifest permission");

const popup = readFileSync(resolve(addon, popupPath), "utf8");
for (const asset of ["unread.css", "unread.js"]) {
  assert.ok(popup.includes(asset), `unread panel must load ${asset}`);
}
for (const control of ["search", "account-filter", "folder-filter", "sort-order", "starred-only", "mark-all-read", "select-visible", "confirm-all-read"]) {
  assert.ok(popup.includes(`id="${control}"`), `unread panel must expose ${control}`);
}
const popupCss = readFileSync(resolve(addon, "unread/unread.css"), "utf8");
const bodyRule = popupCss.match(/body\s*\{([^}]*)\}/)?.[1] || "";
assert.match(bodyRule, /height:\s*600px;/, "popup body must have a deterministic height");
assert.ok(!/\bvh\b/.test(bodyRule), "popup body height must not depend on viewport units");

for (const script of ["background.js", "implementation.js", "unread/unread.js"]) {
  const result = spawnSync("node", ["--check", resolve(addon, script)], { encoding: "utf8" });
  assert.equal(result.status, 0, `${script} syntax check failed: ${result.stderr}`);
}
const unreadScript = readFileSync(resolve(addon, "unread/unread.js"), "utf8");
assert.match(unreadScript, /messages\.query\(\{\s*unread:\s*true/);
assert.match(unreadScript, /messages\.continueList\(/, "all-account actions must handle paginated message lists");
assert.match(unreadScript, /messages\.update\([^,]+,\s*\{\s*read:\s*true\s*\}\)/);
assert.match(unreadScript, /case "oldest"/);
assert.match(unreadScript, /starredOnlyEl\.checked/);

function extractTopLevelFunction(source, name) {
  const pattern = new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}`, "m");
  const match = source.match(pattern);
  assert.ok(match, `missing ${name} function`);
  return match[0];
}

const filterContext = {
  messages: [
    { id: 1, date: "2026-01-02", author: "Zoe", subject: "Alpha", flagged: true, folder: { id: "f1", name: "Inbox", accountId: "a" } },
    { id: 2, date: "2026-01-04", author: "Amy", subject: "Beta", flagged: false, folder: { id: "f2", name: "Archive", accountId: "b" } },
    { id: 3, date: "2026-01-03", author: "Bob", subject: "Needle here", flagged: false, folder: { id: "f1", name: "Inbox", accountId: "a" } }
  ],
  accountFilterEl: { value: "" },
  folderFilterEl: { value: "" },
  searchEl: { value: "" },
  sortOrderEl: { value: "newest" },
  starredOnlyEl: { checked: false },
  collator: new Intl.Collator("zh-CN", { sensitivity: "base", numeric: true }),
  messageAccountId: message => message.folder?.accountId || "",
  folderKey: folder => folder?.id || "",
  accountLabel: id => id || "未知邮箱",
  dateTimestamp: date => new Date(date || 0).getTime()
};
const getVisibleMessages = runInNewContext(`(${extractTopLevelFunction(unreadScript, "getVisibleMessages")})`, filterContext);
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [2, 3, 1]);
filterContext.accountFilterEl.value = "a";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [3, 1]);
filterContext.accountFilterEl.value = "";
filterContext.folderFilterEl.value = "f2";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [2]);
filterContext.folderFilterEl.value = "";
filterContext.starredOnlyEl.checked = true;
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [1]);
filterContext.starredOnlyEl.checked = false;
filterContext.searchEl.value = "needle";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [3]);
filterContext.searchEl.value = "";
filterContext.sortOrderEl.value = "oldest";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [1, 3, 2]);
filterContext.sortOrderEl.value = "sender";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [2, 3, 1]);
filterContext.sortOrderEl.value = "subject";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [1, 2, 3]);
filterContext.sortOrderEl.value = "account";
assert.deepEqual([...getVisibleMessages()].map(message => message.id), [1, 3, 2]);

const queryCalls = [];
const pages = {
  first: { id: "list-1", messages: [{ id: 1, read: false }, { id: 2, read: true }, { id: 3, read: false }] },
  second: { id: "list-2", messages: [{ id: 3, read: false }, { id: 4, read: false }] },
  last: { id: null, messages: [{ id: 5, read: false }] }
};
const paginationContext = {
  extensionApi: { messages: {
    query: async query => { queryCalls.push(query); return pages.first; },
    continueList: async id => id === "list-1" ? pages.second : pages.last,
    abortList: async () => {}
  } },
  normalizePage: page => typeof page === "string" ? { id: page, messages: [] } : page || { id: null, messages: [] },
  setActivity: () => {}
};
const collectAllUnreadIds = runInNewContext(`(${extractTopLevelFunction(unreadScript, "collectAllUnreadIds")})`, paginationContext);
assert.deepEqual([...(await collectAllUnreadIds())], [1, 3, 4, 5]);
assert.equal(queryCalls[0].unread, true);

const updateCalls = [];
const updateContext = {
  BULK_READ_BATCH_SIZE: 20,
  extensionApi: { messages: {
    update: async (id, properties) => {
      updateCalls.push([id, properties.read]);
      if (id === 17) throw new Error("offline");
    }
  } },
  messages: Array.from({ length: 45 }, (_, index) => ({ id: index + 1 })),
  loadedMessageIds: new Set(),
  selectedMessageIds: new Set(Array.from({ length: 45 }, (_, index) => index + 1)),
  bulkActionInProgress: false,
  setError: message => { updateContext.error = message; },
  setActivity: () => {},
  render: () => {},
  refreshMessages: async () => { updateContext.refreshed = true; }
};
const markMessagesRead = runInNewContext(`(${extractTopLevelFunction(unreadScript, "markMessagesRead")})`, updateContext);
await markMessagesRead([...Array.from({ length: 45 }, (_, index) => index + 1), 1], { refreshAfter: true });
assert.equal(updateCalls.length, 45, "bulk read must deduplicate ids and update every batch");
assert.ok(updateCalls.every(([, read]) => read === true));
assert.deepEqual([...updateContext.messages].map(message => message.id), [17]);
assert.deepEqual([...updateContext.selectedMessageIds], [17]);
assert.match(updateContext.error, /44 封已标记为已读，1 封失败/);
assert.equal(updateContext.refreshed, true);

const implementation = readFileSync(resolve(addon, "implementation.js"), "utf8");
const urlGuard = implementation.match(/function isThreePaneURL\(url\) \{[^}]*\}/)?.[0];
assert.ok(urlGuard, "implementation must classify mail three-pane documents");
const isThreePaneURL = runInNewContext(`(${urlGuard})`);
assert.equal(isThreePaneURL("about:3pane"), true);
for (const url of ["about:debugging#/runtime/this-firefox", "about:addons", "imap://mail.example/INBOX"]) {
  assert.equal(isThreePaneURL(url), false, `must skip non-mail document: ${url.split(/[/:]/)[0]}`);
}
assert.match(implementation, /tabContainer\?\.addEventListener\("TabSelect", handleTabSelect\)/);
assert.match(implementation, /MAX_INJECTION_ATTEMPTS/);
assert.match(implementation, /clearInterval\(injectionRetryTimer\)/);

console.log("Unread panel controls, filtering, pagination, batch-read flow and syntax are valid.");
