var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

var doubleClickCloseTab = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      doubleClickCloseTab: {
        async init() {
          const windowListener = {
            onOpenWindow(xulWindow) {
              const domWindow = xulWindow
                .QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIDOMWindow);

              domWindow.addEventListener(
                "load",
                function listener() {
                  domWindow.removeEventListener("load", listener);
                  if (
                    domWindow.location.href ===
                    "chrome://messenger/content/messenger.xhtml"
                  ) {
                    setupDoubleClick(domWindow);
                  }
                },
                { once: true }
              );
            },
          };

          Services.wm.addListener(windowListener);

          // Setup for existing windows
          const windows = Services.wm.getEnumerator("mail:3pane");
          while (windows.hasMoreElements()) {
            const win = windows.getNext();
            setupDoubleClick(win);
          }

          context.extension.callOnClose({
            close() {
              Services.wm.removeListener(windowListener);
            },
          });
        },
        async copyTextToClipboard(text) {
          const value = String(text || "");
          if (!value) {
            throw new Error("No text to copy");
          }

          Cc["@mozilla.org/widget/clipboardhelper;1"]
            .getService(Ci.nsIClipboardHelper)
            .copyString(value);
        },
      },
    };
  }
};

function setupDoubleClick(window) {
  setupTabDoubleClick(window);
  setupTitleBarDoubleClick(window);
  setupMarkAllReadButton(window);
}

function setupTabDoubleClick(window) {
  let tabContainer =
    window.document.getElementById("tabcontainer") ||
    window.document.getElementById("tabmail-tabs") ||
    window.document.querySelector(".tabmail-tabs") ||
    window.document.querySelector("#tabs-toolbar tabs");

  if (!tabContainer) {
    console.log("DoubleClickCloseTab: Could not find tab container");
    return;
  }

  if (tabContainer._doubleClickCloseHandler) {
    tabContainer.removeEventListener(
      "dblclick",
      tabContainer._doubleClickCloseHandler
    );
  }

  const handler = function (event) {
    if (
      event.target.classList?.contains("tab-close-button") ||
      event.target.closest?.(".tab-close-button")
    ) {
      return;
    }

    let target = event.target;
    while (target && target !== tabContainer) {
      if (
        target.tagName?.toLowerCase() === "tab" ||
        target.classList?.contains("tabbrowser-tab") ||
        target.getAttribute?.("role") === "tab" ||
        target.classList?.contains("tabmail-tab")
      ) {
        const tabmail = window.document.getElementById("tabmail");
        if (tabmail) {
          try {
            const tabInfo = target.tabInfo || tabmail.selectedTab;
            if (tabInfo) {
              tabmail.closeTab(tabInfo);
            }
          } catch (e) {
            console.error("DoubleClickCloseTab: Error closing tab", e);
          }
        }
        return;
      }
      target = target.parentNode;
    }
  };

  tabContainer._doubleClickCloseHandler = handler;
  tabContainer.addEventListener("dblclick", handler);
}

function setupTitleBarDoubleClick(window) {
  let titleBar =
    window.document.getElementById("titlebar") ||
    window.document.querySelector(".titlebar") ||
    window.document.querySelector("#toolbar-menubar") ||
    window.document.querySelector("#tabs-toolbar") ||
    window.document.querySelector("#navigation-toolbox");

  if (!titleBar) {
    return;
  }

  if (titleBar._doubleClickMaximizeHandler) {
    titleBar.removeEventListener(
      "dblclick",
      titleBar._doubleClickMaximizeHandler
    );
  }

  const handler = function (event) {
    if (
      event.target.tagName?.toLowerCase() === "button" ||
      event.target.tagName?.toLowerCase() === "toolbarbutton" ||
      event.target.tagName?.toLowerCase() === "menu" ||
      event.target.tagName?.toLowerCase() === "menuitem" ||
      event.target.tagName?.toLowerCase() === "tab" ||
      event.target.closest?.("tab") ||
      event.target.closest?.("tabs") ||
      event.target.classList?.contains("tab-close-button") ||
      event.target.classList?.contains("titlebar-button")
    ) {
      return;
    }

    try {
      if (window.windowState === window.STATE_MAXIMIZED) {
        window.restore();
      } else {
        window.maximize();
      }
    } catch (e) {
      console.error("DoubleClickCloseTab: Error toggling window state", e);
    }
  };

  titleBar._doubleClickMaximizeHandler = handler;
  titleBar.addEventListener("dblclick", handler);
}

function setupMarkAllReadButton(mainWindow) {
  const mainDoc = mainWindow.document;

  // Get the about:3pane contentDocument via multiple approaches
  function getThreePaneDoc() {
    // Approach 1: tabmail.currentBrowser
    try {
      const tabmail = mainDoc.getElementById("tabmail");
      if (tabmail?.currentBrowser?.contentDocument?.body) {
        return tabmail.currentBrowser.contentDocument;
      }
    } catch (e) {}

    // Approach 2: tabmail.currentTabInfo.browser
    try {
      const tabmail = mainDoc.getElementById("tabmail");
      if (tabmail?.currentTabInfo?.browser?.contentDocument?.body) {
        return tabmail.currentTabInfo.browser.contentDocument;
      }
    } catch (e) {}

    // Approach 3: any browser with about:3pane URL
    try {
      const browsers = mainDoc.querySelectorAll("browser");
      for (const b of browsers) {
        try {
          const loc = b.contentDocument?.location?.href || "";
          if (loc === "about:3pane" || loc.includes("3pane")) {
            return b.contentDocument;
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Approach 4: tabpanelcontainer's first browser
    try {
      const container = mainDoc.getElementById("tabpanelcontainer");
      if (container) {
        const browser = container.querySelector("browser");
        if (browser?.contentDocument?.body) {
          return browser.contentDocument;
        }
      }
    } catch (e) {}

    // Approach 5: any browser with a body
    try {
      const browsers = mainDoc.querySelectorAll("browser");
      for (const b of browsers) {
        try {
          if (b.contentDocument?.body) {
            return b.contentDocument;
          }
        } catch (e) {}
      }
    } catch (e) {}

    return null;
  }

  // Recursively search shadow DOM
  function deepQuery(root, matchFn) {
    if (!root) return null;
    try {
      const all = root.querySelectorAll("*");
      for (const el of all) {
        if (matchFn(el)) return el;
        if (el.shadowRoot) {
          const found = deepQuery(el.shadowRoot, matchFn);
          if (found) return found;
        }
      }
    } catch (e) {}
    return null;
  }

  function isButtonLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.localName || el.tagName || "").toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();
    return tag === "button" || tag === "toolbarbutton" || role === "button";
  }

  function getButtonAncestor(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      if (isButtonLike(node)) {
        return node;
      }
      node = node.parentElement || node.parentNode?.host;
    }
    return null;
  }

  function getButtonElement(el) {
    return getButtonAncestor(el) || el;
  }

  function getCurrentFolder(targetWin) {
    try {
      if (targetWin?.gFolder) {
        return targetWin.gFolder;
      }
    } catch (e) {}

    try {
      if (targetWin?.gDBView?.msgFolder) {
        return targetWin.gDBView.msgFolder;
      }
    } catch (e) {}

    try {
      const about3Pane = mainWindow.document.getElementById("tabmail")?.currentAbout3Pane;
      return about3Pane?.gFolder || about3Pane?.gDBView?.msgFolder || null;
    } catch (e) {}

    return null;
  }

  function getFoldersToMarkRead(folder, targetWin) {
    if (!folder) {
      return [];
    }

    try {
      if (folder.flags & Ci.nsMsgFolderFlags.Virtual) {
        const helper = targetWin?.VirtualFolderHelper || mainWindow.VirtualFolderHelper;
        const searchFolders = helper?.wrapVirtualFolder(folder)?.searchFolders;
        if (searchFolders?.length) {
          return searchFolders;
        }
      }
    } catch (e) {}

    return [folder];
  }

  function refreshThreadPane(targetWin) {
    try {
      targetWin?.threadTree?.invalidate?.();
    } catch (e) {}

    try {
      targetWin?.threadTree?.reset?.();
    } catch (e) {}

    try {
      targetWin?.goUpdateCommand?.("cmd_markAllRead");
    } catch (e) {}
  }

  function refreshOpenThreadPanes() {
    refreshThreadPane(mainWindow);

    try {
      const windows = Services.wm.getEnumerator("mail:3pane");
      while (windows.hasMoreElements()) {
        const win = windows.getNext();
        refreshThreadPane(win);
        refreshThreadPane(win.document.getElementById("tabmail")?.currentAbout3Pane);
      }
    } catch (e) {}
  }

  function markCurrentFolderRead(targetWin) {
    const win = targetWin || mainWindow;
    const folders = getFoldersToMarkRead(getCurrentFolder(win), win);

    if (folders.length && typeof mainWindow.MsgMarkAllRead === "function") {
      mainWindow.MsgMarkAllRead(folders);
      win.setTimeout?.(() => refreshThreadPane(win), 0);
      win.setTimeout?.(() => refreshThreadPane(win), 150);
      return;
    }

    if (typeof win.goDoCommand === "function") {
      win.goDoCommand("cmd_markAllRead");
    } else if (typeof mainWindow.goDoCommand === "function") {
      mainWindow.goDoCommand("cmd_markAllRead");
    }
    win.setTimeout?.(() => refreshThreadPane(win), 0);
  }

  function getUnreadMailFolders() {
    const folders = [];
    try {
      for (const server of MailServices.accounts.allServers) {
        const descendants = server.rootFolder?.descendants || [];
        for (const folder of descendants) {
          try {
            if (
              folder.isServer ||
              folder.flags & Ci.nsMsgFolderFlags.Virtual ||
              folder.getNumUnread(false) <= 0
            ) {
              continue;
            }
            folders.push(folder);
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error("collect unread folders error:", e);
    }
    return folders;
  }

  function confirmMarkAllMailRead(unreadCount, folderCount) {
    try {
      return Services.prompt.confirm(
        mainWindow,
        "所有邮件已读",
        `将所有账号中 ${folderCount} 个文件夹的 ${unreadCount} 封未读邮件全部标记为已读？`
      );
    } catch (e) {
      return true;
    }
  }

  function markAllMailRead(targetWin) {
    const folders = getUnreadMailFolders();
    if (!folders.length) {
      return;
    }

    let unreadCount = 0;
    for (const folder of folders) {
      try {
        unreadCount += Math.max(0, folder.getNumUnread(false));
      } catch (e) {}
    }

    if (!confirmMarkAllMailRead(unreadCount, folders.length)) {
      return;
    }

    if (folders.length) {
      if (typeof mainWindow.MsgMarkAllRead === "function") {
        mainWindow.MsgMarkAllRead(folders);
      } else {
        for (const folder of folders) {
          try {
            folder.markAllMessagesRead(mainWindow.msgWindow || null);
          } catch (e) {}
        }
      }
    }

    const win = targetWin || mainWindow;
    win.setTimeout?.(() => refreshOpenThreadPanes(), 0);
    win.setTimeout?.(() => refreshOpenThreadPanes(), 150);
  }

  function syncButtonLayout(buttons, qfBtn, targetWin) {
    const allButtons = Array.isArray(buttons) ? buttons : [buttons];

    const apply = () => {
      const h = qfBtn.getBoundingClientRect().height;
      if (h > 0) {
        const targetHeight = h > 40 ? 32 : Math.min(h, 36);
        const height = targetHeight + "px";
        for (const btn of allButtons) {
          btn.style.setProperty("height", height, "important");
          btn.style.setProperty("min-height", height, "important");
          btn.style.setProperty("max-height", height, "important");
        }
      }

      allButtons.forEach((btn, index) => {
        btn.style.setProperty("margin-inline-start", index === 0 ? "auto" : "4px", "important");
        btn.style.setProperty("margin-inline-end", "0", "important");
      });
      qfBtn.style.setProperty("margin-inline-start", "4px", "important");
      qfBtn.style.setProperty("margin-left", "4px", "important");
    };

    apply();

    if (targetWin.ResizeObserver) {
      const observer = new targetWin.ResizeObserver(apply);
      observer.observe(qfBtn);
      for (const btn of allButtons) {
        btn._markAllReadResizeObserver = observer;
      }
    }
    targetWin.setTimeout(apply, 200);
    targetWin.setTimeout(apply, 1000);
  }

  function makeButton(doc, targetWin, options = {}) {
    const {
      id = "custom-mark-all-read-btn",
      title = "当前文件夹全部已读 (Shift+C)",
      label = "全部已读",
      onClick = markCurrentFolderRead,
    } = options;
    const btn = doc.createElement("button");
    btn.id = id;
    btn.title = title;

    // Match Thunderbird's toolbar button style
    btn.style.cssText = `
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      align-self: center !important;
      gap: 5px !important;
      background-color: var(--button-background-color, transparent) !important;
      border: 1px solid var(--button-border-color, transparent) !important;
      border-radius: var(--button-border-radius, 3px) !important;
      box-sizing: border-box !important;
      color: var(--button-text-color, inherit) !important;
      padding: 0 8px !important;
      margin-block: 0 !important;
      cursor: pointer !important;
      font-size: 0.933em !important;
      font-family: inherit !important;
      line-height: normal !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      flex-shrink: 1 !important;
      min-width: 0 !important;
    `;


    // Inline Thunderbird's compact mail.svg with currentColor for theme support
    btn.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; width: 100%; min-width: 0; overflow: hidden; gap: 5px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="flex-shrink:0;">
          <path d="M3 4h10c.554 0 1 .446 1 1v7c0 .554-.446 1-1 1H3c-.554 0-1-.446-1-1V5c0-.554.446-1 1-1Z" fill="currentColor" fill-opacity="0.5"/>
          <path d="M3 3c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm0 1h10c.563 0 1 .437 1 1v7c0 .563-.437 1-1 1H3c-.563 0-1-.437-1-1V5c0-.563.437-1 1-1Zm.47 1.002a.5.5 0 0 0-.343.166.5.5 0 0 0 .041.705l2.781 2.47-2.803 2.803a.5.5 0 0 0 0 .708.5.5 0 0 0 .708 0L6.697 9.01l.971.863a.5.5 0 0 0 .664 0l.97-.863 2.844 2.844a.5.5 0 0 0 .708 0 .5.5 0 0 0 0-.708L10.05 8.344l2.781-2.471a.5.5 0 0 0 .041-.705.5.5 0 0 0-.705-.041L8 8.832 3.832 5.127a.5.5 0 0 0-.361-.125Z" fill="currentColor"/>
        </svg>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; display: block;">${label}</span>
      </div>
    `;

    btn.addEventListener("mouseover", () => {
      btn.style.setProperty("background-color", "var(--button-hover-background-color, rgba(0,0,0,0.07))", "important");
      btn.style.setProperty("border-color", "var(--button-border-color, rgba(0,0,0,0.15))", "important");
    });
    btn.addEventListener("mouseout", () => {
      btn.style.setProperty("background-color", "var(--button-background-color, transparent)", "important");
      btn.style.setProperty("border-color", "var(--button-border-color, transparent)", "important");
    });
    btn.addEventListener("mousedown", () => {
      btn.style.setProperty("background-color", "var(--button-active-background-color, rgba(0,0,0,0.12))", "important");
    });
    btn.addEventListener("mouseup", () => {
      btn.style.setProperty("background-color", "var(--button-hover-background-color, rgba(0,0,0,0.07))", "important");
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        onClick(targetWin || mainWindow);
      } catch (err) {
        console.error("mark all read error:", err);
      }
    });
    return btn;
  }


  function inject() {
    try {
      // Replace any previously injected button so extension reloads pick up style fixes.
      const threePaneDoc = getThreePaneDoc();
      const buttonIds = [
        "custom-mark-all-read-btn",
        "custom-mark-all-mail-read-btn",
      ];
      for (const doc of [mainDoc, threePaneDoc]) {
        if (!doc) {
          continue;
        }
        for (const id of buttonIds) {
          const existingButton = doc.getElementById(id);
          if (existingButton) {
            existingButton._markAllReadResizeObserver?.disconnect();
            existingButton.remove();
          }
        }
      }

      const doc = threePaneDoc || mainDoc;
      const targetWin = threePaneDoc ? threePaneDoc.defaultView : mainWindow;

      console.log("DoubleClickCloseTab: injecting into doc:", doc.location?.href || "unknown");

      // Search for the quick filter button including shadow DOM
      const qfCandidate = deepQuery(doc, (el) => {
        if (!getButtonAncestor(el)) return false;

        const text = (el.textContent || "").trim();
        const id = (el.id || "").toLowerCase();
        const title = (el.getAttribute("title") || el.getAttribute("tooltiptext") || "").toLowerCase();
        const l10n = (el.getAttribute("data-l10n-id") || "").toLowerCase();
        return (
          text === "快速筛选" ||
          text === "Quick Filter" ||
          id.includes("quickfilter") ||
          title.includes("quick filter") ||
          l10n.includes("quick-filter")
        );
      });
      const qfBtn = qfCandidate ? getButtonElement(qfCandidate) : null;

      if (qfBtn && qfBtn.parentNode) {
        const currentFolderButton = makeButton(doc, targetWin);
        const allMailButton = makeButton(doc, targetWin, {
          id: "custom-mark-all-mail-read-btn",
          title: "所有账号和文件夹全部已读",
          label: "所有已读",
          onClick: markAllMailRead,
        });
        qfBtn.parentNode.insertBefore(currentFolderButton, qfBtn);
        qfBtn.parentNode.insertBefore(allMailButton, qfBtn);
        console.log("DoubleClickCloseTab: Mark All Read buttons injected next to quick filter");
        // Remove fallback if it exists
        mainDoc.getElementById("custom-mark-all-read-btn-fallback")?.remove();

        syncButtonLayout([currentFolderButton, allMailButton], qfBtn, targetWin);

        return true;
      }

      console.log("DoubleClickCloseTab: Quick filter button not found yet, will retry...");
    } catch (e) {
      console.error("DoubleClickCloseTab: inject error", e);
    }
    return false;
  }



  // Initial injection after a short delay (DOM needs time to fully load)
  mainWindow.setTimeout(() => inject(), 1500);

  // Retry periodically
  mainWindow.setInterval(() => {
    const threePaneDoc = getThreePaneDoc();
    const hasCurrentFolderButton =
      mainDoc.getElementById("custom-mark-all-read-btn") ||
      (threePaneDoc && threePaneDoc.getElementById("custom-mark-all-read-btn"));
    const hasAllMailButton =
      mainDoc.getElementById("custom-mark-all-mail-read-btn") ||
      (threePaneDoc && threePaneDoc.getElementById("custom-mark-all-mail-read-btn"));
    const alreadyInjected = hasCurrentFolderButton && hasAllMailButton;
    if (!alreadyInjected) {
      inject();
    }
  }, 3000);
}
