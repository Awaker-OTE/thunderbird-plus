(function () {
  const api = globalThis.messenger || globalThis.browser;
  const GROUP_ID = "tb-plus-notes-action-group";
  const STATUS_ID = "tb-plus-notes-related-status";
  const PANEL_ID = "tb-plus-notes-quick-panel";

  if (!api?.runtime?.sendMessage) {
    return;
  }

  function deepQueryAll(root, selector, results = []) {
    if (!root) {
      return results;
    }

    try {
      if (root.querySelectorAll) {
        results.push(...root.querySelectorAll(selector));
      }
      const elements = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const element of elements) {
        if (element.shadowRoot) {
          deepQueryAll(element.shadowRoot, selector, results);
        }
      }
    } catch (error) {}

    return results;
  }

  function getButtonText(button) {
    return [
      button.textContent,
      button.getAttribute("title"),
      button.getAttribute("aria-label"),
      button.getAttribute("tooltiptext")
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function findMessageToolbar() {
    const buttons = deepQueryAll(document, "button, toolbarbutton, [role='button']");
    const actionButton = buttons.find(button => {
      const text = getButtonText(button);
      return /(回复|Reply|转发|Forward|归档|Archive|删除|Delete|更多|More)/iu.test(text);
    });

    if (!actionButton) {
      return null;
    }

    let node = actionButton.parentElement;
    while (node && node !== document.body) {
      const buttonCount = node.querySelectorAll?.("button, toolbarbutton, [role='button']")?.length || 0;
      if (buttonCount >= 3) {
        return node;
      }
      node = node.parentElement;
    }

    return actionButton.parentElement;
  }

  function findInsertBefore(toolbar) {
    const buttons = Array.from(toolbar.querySelectorAll("button, toolbarbutton, [role='button']"));
    return buttons.find(button => /(更多|More)/iu.test(getButtonText(button))) || null;
  }

  function makeGroup() {
    const group = document.createElement("span");
    group.id = GROUP_ID;
    group.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-inline: 2px;
      vertical-align: middle;
      white-space: nowrap;
    `;

    group.append(
      makeActionButton({
        label: "存入备忘录",
        title: "将当前邮件存入新备忘录",
        action: "saveDisplayedMessageToNote",
        loadingText: "保存中...",
        successText: "已存入",
        icon: notePlusIcon()
      }),
      makeActionButton({
        label: "追加",
        title: "追加当前邮件到当前备忘录",
        action: "appendDisplayedMessageToCurrentNote",
        loadingText: "追加中...",
        successText: "已追加",
        icon: appendIcon()
      }),
      makeActionButton({
        label: "清单",
        title: "将当前邮件转为备忘录待办清单",
        action: "saveDisplayedMessageToChecklist",
        loadingText: "生成中...",
        successText: "已生成",
        icon: checklistIcon()
      }),
      makeActionButton({
        label: "总结",
        title: "AI 总结当前邮件到备忘录",
        action: "summarizeDisplayedMessageToNote",
        loadingText: "总结中...",
        successText: "已保存",
        icon: sparklesIcon()
      }),
      makePanelButton(),
      makeStatusButton()
    );

    return group;
  }

  function makeActionButton({ label, title, action, loadingText, successText, icon }) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    styleButton(button);
    button.innerHTML = `${icon}<span>${label}</span>`;

    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await runMessageAction(button, action, loadingText, successText);
    });

    return button;
  }

  function makePanelButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.title = "打开快速备注面板";
    button.setAttribute("aria-label", "打开快速备注面板");
    styleButton(button);
    button.innerHTML = `${panelIcon()}<span>备注</span>`;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleQuickPanel();
    });
    return button;
  }

  function makeStatusButton() {
    const button = document.createElement("button");
    button.id = STATUS_ID;
    button.type = "button";
    button.hidden = true;
    button.title = "打开这封邮件关联的备忘录";
    button.setAttribute("aria-label", "打开这封邮件关联的备忘录");
    styleButton(button);
    button.style.color = "var(--button-primary-text-color, #0b57d0)";
    button.style.borderColor = "var(--button-primary-border-color, rgba(37, 99, 235, 0.36))";
    button.innerHTML = `${linkIcon()}<span>已有 0 条</span>`;
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await runMessageAction(button, "openRelatedDisplayedMessageNotes", "打开中...", "已打开");
    });
    return button;
  }

  function styleButton(button) {
    button.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 32px;
      padding: 0 9px;
      border: 1px solid var(--button-border-color, rgba(15, 23, 42, 0.22));
      border-radius: var(--button-border-radius, 4px);
      color: var(--button-text-color, inherit);
      background: var(--button-background-color, transparent);
      font: inherit;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    `;
    button.addEventListener("mouseenter", () => {
      if (!button.disabled) {
        button.style.background = "var(--button-hover-background-color, rgba(15, 23, 42, 0.08))";
      }
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "var(--button-background-color, transparent)";
    });
  }

  async function runMessageAction(button, action, loadingText, successText) {
    const oldHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span>${loadingText}</span>`;

    try {
      const response = await api.runtime.sendMessage({ action });
      if (!response?.success) {
        throw new Error(response?.error || "操作失败");
      }

      button.innerHTML = `<span>${successText}</span>`;
      await refreshNoteStatus();
      setTimeout(() => {
        button.innerHTML = oldHtml;
        button.disabled = false;
      }, 1500);
    } catch (error) {
      console.error(`Notes message action failed: ${action}`, error);
      button.innerHTML = "<span>失败</span>";
      button.title = error.message || button.title;
      setTimeout(() => {
        button.innerHTML = oldHtml;
        button.disabled = false;
      }, 2200);
    }
  }

  async function refreshNoteStatus() {
    const button = document.getElementById(STATUS_ID);
    if (!button) {
      return;
    }

    try {
      const response = await api.runtime.sendMessage({
        action: "getDisplayedMessageNoteStatus"
      });
      const count = response?.success ? Number(response.status?.count || 0) : 0;
      button.hidden = count <= 0;
      button.innerHTML = `${linkIcon()}<span>已有 ${count} 条</span>`;
      button.title = count > 0 ? `打开这封邮件关联的 ${count} 条备忘录` : "这封邮件还没有关联备忘录";
    } catch (error) {
      button.hidden = true;
    }
  }

  function toggleQuickPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.hidden = !existing.hidden;
      if (!existing.hidden) {
        existing.querySelector("textarea")?.focus();
      }
      return;
    }

    const panel = makeQuickPanel();
    document.body.appendChild(panel);
    panel.querySelector("textarea")?.focus();
  }

  function makeQuickPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "快速备忘录");
    panel.style.cssText = `
      position: fixed;
      top: 84px;
      right: 18px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      width: min(380px, calc(100vw - 36px));
      max-height: min(520px, calc(100vh - 120px));
      overflow: hidden;
      border: 1px solid rgba(15, 23, 42, 0.18);
      border-radius: 8px;
      color: #1f2937;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    `;

    const header = document.createElement("header");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    `;
    const title = document.createElement("strong");
    title.textContent = "快速备忘录";
    title.style.cssText = "font-size: 14px;";
    const close = document.createElement("button");
    close.type = "button";
    close.title = "关闭";
    close.setAttribute("aria-label", "关闭快速备忘录");
    close.textContent = "×";
    close.style.cssText = `
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      color: #4b5563;
      background: transparent;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    `;
    close.addEventListener("click", () => {
      panel.hidden = true;
    });
    header.append(title, close);

    const body = document.createElement("div");
    body.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      min-height: 0;
    `;
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "标题，可留空";
    titleInput.style.cssText = fieldStyle();
    const textarea = document.createElement("textarea");
    textarea.placeholder = "写下这封邮件的备注...";
    textarea.rows = 8;
    textarea.style.cssText = `${fieldStyle()} min-height: 150px; resize: vertical;`;
    const status = document.createElement("p");
    status.textContent = "保存后仍停留在当前邮件";
    status.style.cssText = "margin: 0; min-height: 18px; color: #6b7280; font-size: 12px;";
    body.append(titleInput, textarea, status);

    const footer = document.createElement("footer");
    footer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid #e5e7eb;
      background: #fff;
    `;
    const appendButton = makePanelActionButton("追加当前", false);
    const saveButton = makePanelActionButton("保存新备忘录", true);
    appendButton.addEventListener("click", () => {
      saveQuickPanelNote(panel, "appendDisplayedMessageQuickNoteToCurrentNote");
    });
    saveButton.addEventListener("click", () => {
      saveQuickPanelNote(panel, "saveDisplayedMessageQuickNote");
    });
    footer.append(appendButton, saveButton);

    panel.append(header, body, footer);
    return panel;
  }

  function fieldStyle() {
    return `
      width: 100%;
      box-sizing: border-box;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px 9px;
      color: #111827;
      background: #fff;
      font: inherit;
      outline: none;
    `;
  }

  function makePanelActionButton(label, primary) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = `
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid ${primary ? "#2563eb" : "#d1d5db"};
      border-radius: 6px;
      color: ${primary ? "#fff" : "#1f2937"};
      background: ${primary ? "#2563eb" : "#fff"};
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    `;
    return button;
  }

  async function saveQuickPanelNote(panel, action) {
    const titleInput = panel.querySelector("input");
    const textarea = panel.querySelector("textarea");
    const status = panel.querySelector("p");
    const buttons = Array.from(panel.querySelectorAll("footer button"));
    const text = textarea.value.trim();

    if (!text) {
      status.textContent = "先输入备注内容";
      status.style.color = "#b42318";
      textarea.focus();
      return;
    }

    buttons.forEach(button => {
      button.disabled = true;
    });
    status.textContent = "正在保存...";
    status.style.color = "#6b7280";

    try {
      const response = await api.runtime.sendMessage({
        action,
        title: titleInput.value.trim(),
        text
      });

      if (!response?.success) {
        throw new Error(response?.error || "保存失败");
      }

      textarea.value = "";
      status.textContent = action === "saveDisplayedMessageQuickNote" ? "已保存为新备忘录" : "已追加到当前备忘录";
      status.style.color = "#166534";
      await refreshNoteStatus();
    } catch (error) {
      status.textContent = error.message || "保存失败";
      status.style.color = "#b42318";
    } finally {
      buttons.forEach(button => {
        button.disabled = false;
      });
    }
  }

  function icon(paths) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto;">
        ${paths}
      </svg>
    `;
  }

  function notePlusIcon() {
    return icon(`
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <path d="M14 2v6h6"></path>
      <path d="M12 18v-6"></path>
      <path d="M9 15h6"></path>
    `);
  }

  function appendIcon() {
    return icon(`
      <path d="M7 7h8a4 4 0 0 1 0 8H5"></path>
      <path d="m8 11-4 4 4 4"></path>
      <path d="M19 3v6"></path>
      <path d="M16 6h6"></path>
    `);
  }

  function checklistIcon() {
    return icon(`
      <path d="M13 5h8"></path>
      <path d="M13 12h8"></path>
      <path d="M13 19h8"></path>
      <path d="m3 7 2 2 4-4"></path>
      <path d="m3 17 2 2 4-4"></path>
    `);
  }

  function panelIcon() {
    return icon(`
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      <path d="M8 8h8"></path>
      <path d="M8 12h5"></path>
    `);
  }

  function sparklesIcon() {
    return icon(`
      <path d="m12 3-1.8 4.8L5.4 9.6l4.8 1.8L12 16.2l1.8-4.8 4.8-1.8-4.8-1.8z"></path>
      <path d="M5 3v4"></path>
      <path d="M3 5h4"></path>
      <path d="M19 17v4"></path>
      <path d="M17 19h4"></path>
    `);
  }

  function linkIcon() {
    return icon(`
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
    `);
  }

  function inject() {
    const existing = document.getElementById(GROUP_ID);
    if (existing) {
      refreshNoteStatus();
      return true;
    }

    const toolbar = findMessageToolbar();
    if (!toolbar) {
      return false;
    }

    const group = makeGroup();
    toolbar.insertBefore(group, findInsertBefore(toolbar));
    refreshNoteStatus();
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (inject() || attempts > 20) {
      clearInterval(timer);
    }
  }, 300);

  inject();
})();
