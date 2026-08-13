const api = globalThis.messenger || globalThis.browser;
const statusEl = document.getElementById("action-status");
const relatedCountEl = document.getElementById("related-count");
const relatedStatusEl = document.getElementById("panel-related-status");
const quickTitleEl = document.getElementById("quick-note-title");
const quickTextEl = document.getElementById("quick-note-text");
const buttons = Array.from(document.querySelectorAll(".action-button"));
const quickButtons = Array.from(document.querySelectorAll(".quick-button"));

const successLabels = {
  translateDisplayedMessageInline: "已执行翻译",
  saveDisplayedMessageToNote: "已存入备忘录",
  appendDisplayedMessageToCurrentNote: "已追加到当前备忘录",
  saveDisplayedMessageToChecklist: "已生成备忘录清单",
  summarizeDisplayedMessageToNote: "已总结到备忘录",
  openRelatedDisplayedMessageNotes: "已打开相关备忘录"
};

function setStatus(text, state = "") {
  statusEl.textContent = text;
  if (state) {
    statusEl.dataset.state = state;
  } else {
    delete statusEl.dataset.state;
  }
}

function setBusy(isBusy) {
  buttons.forEach(button => {
    button.disabled = isBusy;
  });
  quickButtons.forEach(button => {
    button.disabled = isBusy;
  });
}

async function runAction(action) {
  setBusy(true);
  setStatus("正在处理...");

  try {
    const response = await api.runtime.sendMessage({ action });
    if (!response?.success) {
      throw new Error(response?.error || "操作失败");
    }

    setStatus(successLabels[action] || "已完成", "success");
    await refreshRelatedCount();
  } catch (error) {
    setStatus(error.message || "操作失败", "error");
  } finally {
    setBusy(false);
  }
}

async function refreshRelatedCount() {
  try {
    const response = await api.runtime.sendMessage({
      action: "getDisplayedMessageNoteStatus"
    });
    const count = response?.success ? Number(response.status?.count || 0) : 0;
    relatedCountEl.hidden = count <= 0;
    relatedCountEl.textContent = count > 0 ? `${count}` : "";
    relatedStatusEl.textContent = count > 0 ? `已有 ${count} 条备忘录` : "暂无关联备忘录";
  } catch (error) {
    relatedCountEl.hidden = true;
    relatedStatusEl.textContent = "无法读取关联状态";
  }
}

async function runQuickAction(action) {
  const text = quickTextEl.value.trim();
  if (!text) {
    setStatus("先输入备注内容", "error");
    quickTextEl.focus();
    return;
  }

  setBusy(true);
  setStatus("正在保存备注...");

  try {
    const response = await api.runtime.sendMessage({
      action,
      title: quickTitleEl.value.trim(),
      text
    });
    if (!response?.success) {
      throw new Error(response?.error || "保存失败");
    }

    quickTextEl.value = "";
    setStatus(
      action === "saveDisplayedMessageQuickNote" ? "已保存为新备忘录" : "已追加到当前备忘录",
      "success"
    );
    await refreshRelatedCount();
  } catch (error) {
    setStatus(error.message || "保存失败", "error");
  } finally {
    setBusy(false);
  }
}

buttons.forEach(button => {
  button.addEventListener("click", () => {
    runAction(button.dataset.action);
  });
});

quickButtons.forEach(button => {
  button.addEventListener("click", () => {
    runQuickAction(button.dataset.quickAction);
  });
});

refreshRelatedCount();
