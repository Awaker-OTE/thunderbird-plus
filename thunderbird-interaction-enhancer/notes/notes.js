const DB_NAME = "thunderbird-interaction-enhancer-notes";
const DB_VERSION = 1;
const DEFAULT_FOLDER_ID = "default";
const NOTE_SAVE_DELAY = 450;

const state = {
  db: null,
  notes: [],
  folders: [],
  selectedNoteId: null,
  selectedView: "all",
  selectedFolderId: null,
  sourceFilter: null,
  query: "",
  saveTimer: null,
  isApplyingNote: false
};

const dom = {
  folderList: document.getElementById("folderList"),
  notesList: document.getElementById("notesList"),
  listTitle: document.getElementById("listTitle"),
  listSubtitle: document.getElementById("listSubtitle"),
  allCount: document.getElementById("allCount"),
  pinnedCount: document.getElementById("pinnedCount"),
  trashCount: document.getElementById("trashCount"),
  newFolderButton: document.getElementById("newFolderButton"),
  newNoteButton: document.getElementById("newNoteButton"),
  emptyNewNoteButton: document.getElementById("emptyNewNoteButton"),
  trashDeleteAllButton: document.getElementById("trashDeleteAllButton"),
  searchInput: document.getElementById("searchInput"),
  noteContextMenu: document.getElementById("noteContextMenu"),
  emptyState: document.getElementById("emptyState"),
  editorShell: document.getElementById("editorShell"),
  noteDate: document.getElementById("noteDate"),
  saveState: document.getElementById("saveState"),
  pinButton: document.getElementById("pinButton"),
  deleteButton: document.getElementById("deleteButton"),
  restoreButton: document.getElementById("restoreButton"),
  permanentDeleteButton: document.getElementById("permanentDeleteButton"),
  trashActions: document.getElementById("trashActions"),
  titleInput: document.getElementById("titleInput"),
  editor: document.getElementById("editor"),
  blockSelect: document.getElementById("blockSelect"),
  checklistButton: document.getElementById("checklistButton"),
  highlightButton: document.getElementById("highlightButton"),
  linkButton: document.getElementById("linkButton"),
  dateButton: document.getElementById("dateButton"),
  mailRefButton: document.getElementById("mailRefButton")
};

init().catch(error => {
  console.error("Notes init failed:", error);
  dom.notesList.textContent = "备忘录加载失败";
});

async function init() {
  state.db = await openDatabase();
  await ensureDefaultFolder();
  await reloadData();
  selectNoteFromHash();
  bindEvents();
  render();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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

async function getAll(storeName) {
  const transaction = state.db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  return await requestToPromise(store.getAll());
}

async function put(storeName, value) {
  const transaction = state.db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  return value;
}

async function remove(storeName, id) {
  const transaction = state.db.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).delete(id);
  await transactionDone(transaction);
}

async function ensureDefaultFolder() {
  const folders = await getAll("folders");
  if (folders.some(folder => folder.id === DEFAULT_FOLDER_ID)) {
    return;
  }

  const now = new Date().toISOString();
  await put("folders", {
    id: DEFAULT_FOLDER_ID,
    name: "备忘录",
    createdAt: now,
    updatedAt: now
  });
}

async function reloadData() {
  const [notes, folders] = await Promise.all([
    getAll("notes"),
    getAll("folders")
  ]);

  state.notes = notes.sort(sortNotes);
  state.folders = folders.sort((a, b) => {
    if (a.id === DEFAULT_FOLDER_ID) return -1;
    if (b.id === DEFAULT_FOLDER_ID) return 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

  if (state.selectedNoteId && !state.notes.some(note => note.id === state.selectedNoteId)) {
    state.selectedNoteId = null;
  }
}

function bindEvents() {
  dom.newNoteButton.addEventListener("click", () => createNote());
  dom.emptyNewNoteButton.addEventListener("click", () => createNote());
  dom.newFolderButton.addEventListener("click", createFolder);

  dom.searchInput.addEventListener("input", event => {
    state.query = event.target.value.trim().toLowerCase();
    renderNotesList();
  });

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", async () => {
      await flushPendingSave();
      state.sourceFilter = null;
      state.selectedView = button.dataset.view;
      state.selectedFolderId = null;
      selectFirstVisibleNote();
      render();
    });
  });

  dom.titleInput.addEventListener("input", queueSaveCurrentNote);
  dom.editor.addEventListener("input", queueSaveCurrentNote);
  dom.editor.addEventListener("paste", handleEditorPaste);
  dom.blockSelect.addEventListener("change", applyBlockStyle);

  dom.pinButton.addEventListener("click", togglePinned);
  dom.deleteButton.addEventListener("click", moveSelectedNoteToTrash);
  dom.restoreButton.addEventListener("click", restoreSelectedNote);
  dom.permanentDeleteButton.addEventListener("click", permanentlyDeleteSelectedNote);
  dom.trashDeleteAllButton.addEventListener("click", permanentlyDeleteAllTrashedNotes);

  document.querySelectorAll("[data-command]").forEach(button => {
    button.addEventListener("click", () => {
      dom.editor.focus();
      document.execCommand(button.dataset.command, false, button.dataset.value || null);
      queueSaveCurrentNote();
      updateToolbarState();
    });
  });

  dom.highlightButton.addEventListener("click", applyHighlight);
  dom.checklistButton.addEventListener("click", () => {
    dom.editor.focus();
    document.execCommand("insertHTML", false, '<ul data-checklist="true"><li><br></li></ul>');
    queueSaveCurrentNote();
  });

  dom.linkButton.addEventListener("click", () => {
    const url = prompt("输入链接地址");
    if (!url) return;

    dom.editor.focus();
    document.execCommand("createLink", false, normalizeLink(url));
    queueSaveCurrentNote();
  });

  dom.dateButton.addEventListener("click", insertCurrentDateTime);
  dom.mailRefButton.addEventListener("click", insertMailReference);

  document.addEventListener("selectionchange", updateToolbarState);
  document.addEventListener("contextmenu", event => {
    if (!event.target.closest?.(".note-card")) {
      const api = globalThis.messenger || globalThis.browser;
      if (api?.menus?.update) {
        api.menus.update("native-note-delete", { visible: false });
        api.menus.update("native-note-restore", { visible: false });
        api.menus.update("native-note-permanent-delete", { visible: false });
      }
    }
  });

  const api = globalThis.messenger || globalThis.browser;
  if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener(request => {
      if (request.action === "executeNativeMenuAction") {
        if (request.menuItemId === "native-note-delete") {
          moveSelectedNoteToTrash();
        } else if (request.menuItemId === "native-note-restore") {
          restoreSelectedNote();
        } else if (request.menuItemId === "native-note-permanent-delete") {
          permanentlyDeleteSelectedNote();
        }
      }
    });
  }

  window.addEventListener("hashchange", () => {
    if (selectNoteFromHash()) {
      render();
    }
  });
}

function selectNoteFromHash() {
  const hash = window.location.hash || "";
  const noteMatch = hash.match(/^#note=(.+)$/u);
  if (noteMatch) {
    const noteId = decodeURIComponent(noteMatch[1]);
    const note = state.notes.find(item => item.id === noteId);
    if (!note) {
      return false;
    }

    state.sourceFilter = null;
    state.selectedNoteId = note.id;
    state.selectedView = note.deletedAt ? "trash" : "folder";
    state.selectedFolderId = note.deletedAt ? null : note.folderId || DEFAULT_FOLDER_ID;
    return true;
  }

  const sourceMatch = hash.match(/^#source(Header|Message)=(.+)$/u);
  if (sourceMatch) {
    state.sourceFilter = {
      type: sourceMatch[1] === "Header" ? "header" : "message",
      value: decodeURIComponent(sourceMatch[2])
    };
    state.selectedView = "all";
    state.selectedFolderId = null;
    state.query = "";
    dom.searchInput.value = "";
    selectFirstVisibleNote();
    return true;
  }

  if (state.sourceFilter && !hash) {
    state.sourceFilter = null;
    return true;
  }

  return false;
}

function applyBlockStyle() {
  const value = dom.blockSelect.value || "p";
  dom.editor.focus();
  document.execCommand("formatBlock", false, value);
  queueSaveCurrentNote();
  updateToolbarState();
}

function applyHighlight() {
  dom.editor.focus();
  const applied = document.execCommand("hiliteColor", false, "#fff2a8");
  if (!applied) {
    document.execCommand("backColor", false, "#fff2a8");
  }
  queueSaveCurrentNote();
}

function insertCurrentDateTime() {
  dom.editor.focus();
  document.execCommand("insertText", false, formatInsertedDateTime(new Date()));
  queueSaveCurrentNote();
}

async function insertMailReference() {
  const api = globalThis.messenger || globalThis.browser;
  if (!api?.runtime?.sendMessage) {
    alert("邮件引用只能在 Thunderbird 扩展环境中使用");
    return;
  }

  try {
    const response = await api.runtime.sendMessage({
      action: "getLastDisplayedMessageReference"
    });

    if (!response?.success || !response.message) {
      alert(response?.error || "没有检测到最近打开的邮件");
      return;
    }

    const message = response.message;
    const lines = [
      message.author ? `发件人：${message.author}` : "",
      message.recipients ? `收件人：${message.recipients}` : "",
      message.date ? `时间：${formatInsertedDateTime(new Date(message.date))}` : ""
    ].filter(Boolean);

    insertHtmlAtCursor(`
      <blockquote data-mail-reference="true" data-message-id="${escapeHtml(String(message.id || ""))}" data-header-message-id="${escapeHtml(message.headerMessageId || "")}">
        <strong>邮件：${escapeHtml(message.subject || "无主题")}</strong>
        <small>${escapeHtml(lines.join(" · "))}</small>
      </blockquote>
      <p><br></p>
    `);
  } catch (error) {
    console.error("Insert mail reference failed:", error);
    alert(`插入邮件引用失败：${error.message}`);
  }
}

function insertHtmlAtCursor(html) {
  dom.editor.focus();
  document.execCommand("insertHTML", false, sanitizeHtml(html));
  queueSaveCurrentNote();
}

async function createFolder() {
  await flushPendingSave();
  state.sourceFilter = null;

  const name = prompt("文件夹名称");
  const trimmed = (name || "").trim();
  if (!trimmed) return;

  const now = new Date().toISOString();
  const folder = {
    id: createId("folder"),
    name: trimmed.slice(0, 40),
    createdAt: now,
    updatedAt: now
  };

  await put("folders", folder);
  await reloadData();
  state.selectedView = "folder";
  state.selectedFolderId = folder.id;
  state.selectedNoteId = null;
  render();
}

async function createNote() {
  await flushPendingSave();
  state.sourceFilter = null;

  const now = new Date().toISOString();
  const folderId = state.selectedView === "folder" && state.selectedFolderId
    ? state.selectedFolderId
    : DEFAULT_FOLDER_ID;

  const note = {
    id: createId("note"),
    title: "",
    body: "",
    bodyText: "",
    folderId,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };

  await put("notes", note);
  await reloadData();
  state.selectedView = "folder";
  state.selectedFolderId = folderId;
  state.selectedNoteId = note.id;
  render();
  dom.titleInput.focus();
}

function createId(prefix) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

function render() {
  renderFolders();
  renderCounts();
  renderNotesList();
  renderEditor();
}

function renderFolders() {
  const activeRows = document.querySelectorAll("[data-view]");
  activeRows.forEach(row => {
    row.classList.toggle(
      "is-active",
      row.dataset.view === state.selectedView && !state.selectedFolderId && !state.sourceFilter
    );
  });

  dom.folderList.replaceChildren();
  for (const folder of state.folders) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-row";
    button.classList.toggle(
      "is-active",
      state.selectedView === "folder" && state.selectedFolderId === folder.id && !state.sourceFilter
    );
    button.addEventListener("click", async () => {
      await flushPendingSave();
      state.sourceFilter = null;
      state.selectedView = "folder";
      state.selectedFolderId = folder.id;
      selectFirstVisibleNote();
      render();
    });

    button.appendChild(createFolderIcon());
    button.appendChild(createTextSpan(folder.name));

    const count = document.createElement("strong");
    count.textContent = countNotes(note => !note.deletedAt && note.folderId === folder.id);
    button.appendChild(count);

    dom.folderList.appendChild(button);
  }
}

function renderCounts() {
  dom.allCount.textContent = countNotes(note => !note.deletedAt);
  dom.pinnedCount.textContent = countNotes(note => !note.deletedAt && note.pinned);
  dom.trashCount.textContent = countNotes(note => Boolean(note.deletedAt));
}

function renderNotesList() {
  const visibleNotes = getVisibleNotes();
  const title = getCurrentTitle();

  dom.listTitle.textContent = title;
  dom.listSubtitle.textContent = state.sourceFilter
    ? `${visibleNotes.length} 条关联备忘录`
    : `${visibleNotes.length} 条备忘录`;
  renderListActions();
  dom.notesList.replaceChildren();

  if (!state.selectedNoteId && visibleNotes.length > 0) {
    state.selectedNoteId = visibleNotes[0].id;
  }

  if (state.selectedNoteId && !visibleNotes.some(note => note.id === state.selectedNoteId)) {
    state.selectedNoteId = visibleNotes[0]?.id || null;
  }

  if (visibleNotes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = state.sourceFilter
      ? "没有关联备忘录"
      : state.query ? "没有匹配的备忘录" : "没有备忘录";
    dom.notesList.appendChild(empty);
    renderEditor();
    return;
  }

  for (const note of visibleNotes) {
    dom.notesList.appendChild(createNoteCard(note));
  }

  renderEditor();
}

function createNoteCard(note) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "note-card";
  card.classList.toggle("is-selected", note.id === state.selectedNoteId);
  card.setAttribute("role", "option");
  card.setAttribute("aria-selected", String(note.id === state.selectedNoteId));
  card.addEventListener("click", async () => {
    await flushPendingSave();
    state.selectedNoteId = note.id;
    renderNotesList();
  });
  card.addEventListener("contextmenu", async event => {
    event.stopPropagation();
    await flushPendingSave();

    const currentNote = state.notes.find(item => item.id === note.id) || note;
    state.selectedNoteId = currentNote.id;
    renderNotesList();

    const api = globalThis.messenger || globalThis.browser;
    if (api?.menus?.update) {
      const isDeleted = Boolean(currentNote.deletedAt);
      api.menus.update("native-note-delete", { visible: !isDeleted });
      api.menus.update("native-note-restore", { visible: isDeleted });
      api.menus.update("native-note-permanent-delete", { visible: isDeleted });
    }
  });

  const title = document.createElement("div");
  title.className = "note-card-title";
  if (note.pinned && !note.deletedAt) {
    const dot = document.createElement("i");
    dot.className = "pin-dot";
    title.appendChild(dot);
  }
  const titleText = document.createElement("span");
  titleText.textContent = note.title || "新建备忘录";
  title.appendChild(titleText);

  const meta = document.createElement("div");
  meta.className = "note-card-meta";
  meta.textContent = note.deletedAt
    ? `删除于 ${formatCompactDate(note.deletedAt)}`
    : formatCompactDate(note.updatedAt);

  const preview = document.createElement("div");
  preview.className = "note-card-preview";
  preview.textContent = note.bodyText || "无更多内容";

  card.append(title, meta, preview);
  return card;
}

function renderEditor() {
  const note = getSelectedNote();
  const hasNote = Boolean(note);

  dom.emptyState.hidden = hasNote;
  dom.editorShell.hidden = !hasNote;

  if (!note) {
    return;
  }

  state.isApplyingNote = true;
  dom.titleInput.value = note.title || "";
  dom.editor.innerHTML = sanitizeHtml(note.body || "");
  dom.noteDate.textContent = note.deletedAt
    ? `删除于 ${formatLongDate(note.deletedAt)}`
    : `编辑于 ${formatLongDate(note.updatedAt)}`;
  dom.saveState.textContent = "已保存";
  dom.pinButton.classList.toggle("is-active", Boolean(note.pinned));
  dom.pinButton.disabled = Boolean(note.deletedAt);
  dom.deleteButton.hidden = Boolean(note.deletedAt);
  dom.trashActions.hidden = !note.deletedAt;
  dom.titleInput.disabled = Boolean(note.deletedAt);
  dom.editor.contentEditable = note.deletedAt ? "false" : "true";
  setEditorControlsDisabled(Boolean(note.deletedAt));
  rememberCurrentNote(note);
  state.isApplyingNote = false;
  updateToolbarState();
}

function setEditorControlsDisabled(disabled) {
  document.querySelectorAll(".format-toolbar button, .format-toolbar select").forEach(control => {
    control.disabled = disabled;
  });
}

function rememberCurrentNote(note) {
  if (note.deletedAt) {
    return;
  }

  const api = globalThis.messenger || globalThis.browser;
  if (!api?.storage?.local?.set) {
    return;
  }

  api.storage.local.set({
    currentNoteId: note.id,
    currentNoteTitle: note.title || "新建备忘录"
  }).catch(error => {
    console.warn("Could not remember current note:", error);
  });
}

function getVisibleNotes() {
  let notes = state.notes;

  if (state.selectedView === "pinned") {
    notes = notes.filter(note => !note.deletedAt && note.pinned);
  } else if (state.selectedView === "trash") {
    notes = notes.filter(note => Boolean(note.deletedAt));
  } else if (state.selectedView === "folder") {
    notes = notes.filter(note => !note.deletedAt && note.folderId === state.selectedFolderId);
  } else {
    notes = notes.filter(note => !note.deletedAt);
  }

  if (state.sourceFilter) {
    notes = notes.filter(note => noteMatchesSourceFilter(note));
  }

  if (state.query) {
    notes = notes.filter(note => {
      const text = `${note.title || ""} ${note.bodyText || ""}`.toLowerCase();
      return text.includes(state.query);
    });
  }

  return [...notes].sort(sortNotes);
}

function sortNotes(a, b) {
  if (a.deletedAt || b.deletedAt) {
    return new Date(b.deletedAt || b.updatedAt) - new Date(a.deletedAt || a.updatedAt);
  }
  if (a.pinned !== b.pinned) {
    return a.pinned ? -1 : 1;
  }
  return new Date(b.updatedAt) - new Date(a.updatedAt);
}

function selectFirstVisibleNote() {
  const notes = getVisibleNotes();
  state.selectedNoteId = notes[0]?.id || null;
}

function getSelectedNote() {
  return state.notes.find(note => note.id === state.selectedNoteId) || null;
}

function countNotes(predicate) {
  return state.notes.filter(predicate).length;
}

function getCurrentTitle() {
  if (state.sourceFilter) return "关联邮件";
  if (state.selectedView === "pinned") return "置顶";
  if (state.selectedView === "trash") return "最近删除";
  if (state.selectedView === "folder") {
    return state.folders.find(folder => folder.id === state.selectedFolderId)?.name || "文件夹";
  }
  return "全部备忘录";
}

function noteMatchesSourceFilter(note) {
  const filter = state.sourceFilter;
  if (!filter?.value) {
    return false;
  }

  const body = String(note.body || "");
  if (filter.type === "message") {
    const messageId = String(filter.value);
    return String(note.sourceMessageId || "") === messageId ||
      body.includes(`data-message-id="${escapeHtml(messageId)}"`);
  }

  return note.sourceHeaderMessageId === filter.value ||
    body.includes(`data-header-message-id="${escapeHtml(filter.value)}"`);
}

function queueSaveCurrentNote() {
  if (state.isApplyingNote) return;

  dom.saveState.textContent = "正在保存...";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveCurrentNote().catch(error => {
      console.error("Save note failed:", error);
      dom.saveState.textContent = "保存失败";
    });
  }, NOTE_SAVE_DELAY);
}

async function flushPendingSave() {
  if (!state.saveTimer) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  try {
    await saveCurrentNote();
  } catch (error) {
    console.error("Save note failed:", error);
  }
}

async function saveCurrentNote() {
  const note = getSelectedNote();
  if (!note || note.deletedAt) return;

  const cleanBody = sanitizeHtml(dom.editor.innerHTML);
  const updated = {
    ...note,
    title: dom.titleInput.value.trim().slice(0, 160),
    body: cleanBody,
    bodyText: htmlToPlainText(cleanBody).slice(0, 20000),
    updatedAt: new Date().toISOString()
  };

  await put("notes", updated);
  state.saveTimer = null;
  await reloadData();
  dom.saveState.textContent = "已保存";
  renderCounts();
  renderNotesListPreservingEditor(updated.id);
  rememberCurrentNote(updated);
}

function renderNotesListPreservingEditor(noteId) {
  const currentEditorSelection = document.activeElement === dom.editor || dom.editor.contains(document.activeElement);
  state.selectedNoteId = noteId;

  const visibleNotes = getVisibleNotes();
  dom.listSubtitle.textContent = state.sourceFilter
    ? `${visibleNotes.length} 条关联备忘录`
    : `${visibleNotes.length} 条备忘录`;
  renderListActions();
  dom.notesList.replaceChildren();

  if (visibleNotes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = state.sourceFilter
      ? "没有关联备忘录"
      : state.query ? "没有匹配的备忘录" : "没有备忘录";
    dom.notesList.appendChild(empty);
    return;
  }

  for (const note of visibleNotes) {
    dom.notesList.appendChild(createNoteCard(note));
  }

  const note = getSelectedNote();
  if (note) {
    dom.noteDate.textContent = `编辑于 ${formatLongDate(note.updatedAt)}`;
  }

  if (currentEditorSelection) {
    dom.editor.focus();
  }
}

async function togglePinned() {
  const note = getSelectedNote();
  if (!note || note.deletedAt) return;

  await put("notes", {
    ...note,
    pinned: !note.pinned,
    updatedAt: new Date().toISOString()
  });
  await reloadData();
  render();
}

async function moveSelectedNoteToTrash() {
  await moveNoteToTrash(state.selectedNoteId);
}

async function moveNoteToTrash(noteId) {
  const note = state.notes.find(item => item.id === noteId);
  if (!note || note.deletedAt) return;

  await put("notes", {
    ...note,
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await reloadData();
  selectFirstVisibleNote();
  render();
}

async function restoreSelectedNote() {
  await restoreNote(state.selectedNoteId);
}

async function restoreNote(noteId) {
  const note = state.notes.find(item => item.id === noteId);
  if (!note || !note.deletedAt) return;

  await put("notes", {
    ...note,
    deletedAt: null,
    updatedAt: new Date().toISOString()
  });
  await reloadData();
  state.selectedView = "folder";
  state.selectedFolderId = note.folderId || DEFAULT_FOLDER_ID;
  state.selectedNoteId = note.id;
  render();
}

async function permanentlyDeleteSelectedNote() {
  await permanentlyDeleteNote(state.selectedNoteId);
}

async function permanentlyDeleteNote(noteId) {
  const note = state.notes.find(item => item.id === noteId);
  if (!note || !note.deletedAt) return;

  const ok = confirm("永久删除这条备忘录？");
  if (!ok) return;

  await remove("notes", note.id);
  await reloadData();
  selectFirstVisibleNote();
  render();
}

async function permanentlyDeleteAllTrashedNotes() {
  const trashedNoteIds = state.notes
    .filter(note => Boolean(note.deletedAt))
    .map(note => note.id);

  if (trashedNoteIds.length === 0) return;

  const ok = confirm(`永久删除最近删除中的 ${trashedNoteIds.length} 条备忘录？`);
  if (!ok) return;

  const transaction = state.db.transaction("notes", "readwrite");
  const store = transaction.objectStore("notes");
  for (const noteId of trashedNoteIds) {
    store.delete(noteId);
  }
  await transactionDone(transaction);

  await reloadData();
  if (trashedNoteIds.includes(state.selectedNoteId)) {
    state.selectedNoteId = null;
  }
  selectFirstVisibleNote();
  render();
}

function renderListActions() {
  const trashCount = countNotes(note => Boolean(note.deletedAt));
  const showDeleteAll = state.selectedView === "trash" && !state.sourceFilter && trashCount > 0;
  dom.trashDeleteAllButton.hidden = !showDeleteAll;
  dom.trashDeleteAllButton.disabled = !showDeleteAll;
}



function handleEditorPaste(event) {
  event.preventDefault();
  const clipboard = event.clipboardData;
  const html = clipboard.getData("text/html");
  const text = clipboard.getData("text/plain");
  const content = html ? sanitizeHtml(html) : escapeHtml(text).replace(/\n/g, "<br>");
  document.execCommand("insertHTML", false, content);
  queueSaveCurrentNote();
}

function sanitizeHtml(html) {
  if (!html) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html), "text/html");
  const allowedTags = new Set([
    "A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "H2", "H3", "I", "LI",
    "MARK", "OL", "P", "SMALL", "SPAN", "STRONG", "U", "UL"
  ]);
  const allowedAttrs = {
    A: new Set(["href", "title"]),
    BLOCKQUOTE: new Set(["data-mail-reference", "data-message-id", "data-header-message-id"]),
    MARK: new Set(["data-highlight"]),
    SPAN: new Set(["style"]),
    UL: new Set(["data-checklist"])
  };

  const cleanNode = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      return doc.createTextNode(node.textContent);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const tag = node.tagName.toUpperCase();
    const replacement = allowedTags.has(tag)
      ? doc.createElement(tag.toLowerCase())
      : doc.createDocumentFragment();

    if (allowedTags.has(tag)) {
      for (const attr of Array.from(node.attributes)) {
        const attrName = attr.name.toLowerCase();
        if (!allowedAttrs[tag]?.has(attrName)) continue;

        if (tag === "A" && attrName === "href") {
          const safeHref = normalizeLink(attr.value);
          if (!safeHref) continue;
          replacement.setAttribute("href", safeHref);
          replacement.setAttribute("rel", "noreferrer");
        } else if (tag === "SPAN" && attrName === "style") {
          const safeStyle = sanitizeInlineStyle(attr.value);
          if (safeStyle) {
            replacement.setAttribute("style", safeStyle);
          }
        } else {
          replacement.setAttribute(attrName, attr.value);
        }
      }
    }

    for (const child of Array.from(node.childNodes)) {
      const cleaned = cleanNode(child);
      if (cleaned) replacement.appendChild(cleaned);
    }

    return replacement;
  };

  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = cleanNode(child);
    if (cleaned) fragment.appendChild(cleaned);
  }

  const container = doc.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML
    .replace(/<div><br><\/div>/g, "<p><br></p>")
    .trim();
}

function sanitizeInlineStyle(value) {
  const style = String(value || "");
  const background = style.match(/background(?:-color)?\s*:\s*([^;]+)/iu)?.[1]?.trim();
  if (!background) {
    return "";
  }

  if (
    /^#[0-9a-f]{3,8}$/iu.test(background) ||
    /^rgb(a)?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/iu.test(background)
  ) {
    return `background-color: ${background};`;
  }

  return "";
}

function normalizeLink(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  if (/^(https?:|mailto:)/iu.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/iu.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return "";
}

function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  return (doc.body.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createFolderIcon() {
  const span = document.createElement("span");
  span.className = "folder-icon";
  span.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6.5h5l1.4 1.8h6.6v6.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/></svg>';
  return span;
}

function createTextSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function formatCompactDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return "昨天";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric"
  }).format(date);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatInsertedDateTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function updateToolbarState() {
  const activeCommands = new Set(["bold", "italic", "underline"]);
  document.querySelectorAll("[data-command]").forEach(button => {
    const command = button.dataset.command;
    if (!activeCommands.has(command)) return;

    try {
      button.classList.toggle("is-active", document.queryCommandState(command));
    } catch (error) {
      button.classList.remove("is-active");
    }
  });

  try {
    const block = String(document.queryCommandValue("formatBlock") || "p").toLowerCase();
    const normalized = block.replace(/[<>]/g, "");
    dom.blockSelect.value = ["h2", "h3", "blockquote"].includes(normalized) ? normalized : "p";
  } catch (error) {
    dom.blockSelect.value = "p";
  }
}
