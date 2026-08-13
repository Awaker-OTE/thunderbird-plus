(function () {
  if (window.__thunderbirdInlineTranslatorInstalled) {
    return;
  }
  window.__thunderbirdInlineTranslatorInstalled = true;

  const extensionApi = globalThis.messenger || globalThis.browser;
  const HOST_ID = "thunderbird-inline-translation-host";

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) {
      return host;
    }

    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.display = "block";
    host.style.margin = "0 0 16px 0";
    host.style.clear = "both";

    if (document.body.firstChild) {
      document.body.insertBefore(host, document.body.firstChild);
    } else {
      document.body.appendChild(host);
    }

    host.attachShadow({ mode: "open" });
    return host;
  }

  function appendTextBlock(parent, className, text) {
    const block = document.createElement("div");
    block.className = className;
    block.textContent = text || "";
    parent.appendChild(block);
  }

  function renderTranslation(payload) {
    const host = ensureHost();
    const shadow = host.shadowRoot;
    while (shadow.firstChild) {
      shadow.removeChild(shadow.firstChild);
    }

    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        color-scheme: light;
      }
      .panel {
        all: initial;
        display: block;
        box-sizing: border-box;
        margin: 0 0 16px 0;
        padding: 14px 16px;
        border: 1px solid #b8d8ff;
        border-left: 4px solid #0876d8;
        border-radius: 6px;
        background: #f5faff;
        color: #1f2933;
        font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        white-space: normal;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .title {
        font-weight: 700;
        font-size: 15px;
        color: #0b5cad;
      }
      .meta {
        margin-bottom: 10px;
        color: #607080;
        font-size: 12px;
      }
      .content {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .loading {
        color: #607080;
      }
      .error {
        color: #b42318;
        background: #fff1f0;
        border: 1px solid #ffccc7;
        border-radius: 4px;
        padding: 10px;
      }
      .close {
        appearance: none;
        border: 1px solid #b8c7d9;
        border-radius: 4px;
        background: #ffffff;
        color: #1f2933;
        cursor: pointer;
        font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 4px 8px;
      }
      .close:hover {
        background: #eef6ff;
      }
    `;
    shadow.appendChild(style);

    const panel = document.createElement("section");
    panel.className = "panel";

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = payload.title || "邮件翻译";
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.textContent = "关闭";
    close.addEventListener("click", () => host.remove());
    header.appendChild(title);
    header.appendChild(close);
    panel.appendChild(header);

    if (payload.meta) {
      appendTextBlock(panel, "meta", payload.meta);
    }

    if (payload.status === "error") {
      appendTextBlock(panel, "error", payload.message || "翻译失败");
    } else if (payload.status === "loading") {
      appendTextBlock(panel, "loading", payload.message || "正在翻译...");
    } else {
      appendTextBlock(panel, "content", payload.text || "");
    }

    shadow.appendChild(panel);
  }

  if (extensionApi?.runtime?.onMessage) {
    extensionApi.runtime.onMessage.addListener((message) => {
      if (message?.action !== "showInlineTranslation") {
        return false;
      }

      renderTranslation(message);
      return Promise.resolve({ ok: true });
    });
  }
})();
