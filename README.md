<p align="center">
  <img src="./thunderbird-interaction-enhancer/icons/thunderbird-plus-128.png" width="112" alt="Thunderbird Plus" />
</p>

<h1 align="center">Thunderbird Plus</h1>

<p align="center">
  为 Thunderbird 补齐日常最缺的四件事：<br />
  <strong>跨邮箱未读总览</strong> · <strong>双击关闭标签页</strong> · <strong>AI 邮件翻译</strong> · <strong>随手备忘录</strong>
</p>

<p align="center">
  <a href="https://github.com/Awaker-OTE/thunderbird-plus/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Awaker-OTE/thunderbird-plus?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MPL--2.0-blue?style=flat-square" /></a>
  <img alt="Thunderbird" src="https://img.shields.io/badge/Thunderbird-128%2B-0A84FF?style=flat-square" />
</p>

<p align="center">
  <a href="#中文说明">中文说明</a>
  &nbsp;·&nbsp;
  <a href="#english">English</a>
</p>

---

## 中文说明

### 这是什么

Thunderbird Plus 是一个面向 **Thunderbird 128+** 的扩展（Manifest V2 + 实验性 API），
把四处分散的高频操作收进同一个界面。它不是主题，也不改版式，只补功能。

### 功能

#### 1. 跨邮箱未读面板

- 工具栏图标弹出面板，**一次列出所有账号、所有文件夹的未读邮件**——不必逐个账号点开。
- 图标上带**全局未读总数角标**；鼠标悬停时标题也会带数字，图标被折叠进溢出菜单时同样可见。
- 面板支持按账号 / 文件夹筛选，三段式摘要文案（`全局未读 N 封 · 当前筛选 M 封 · 已加载 K 封`），
  避免筛选后误以为全邮箱只有 M 封。
- 一键「全部已读」，口径与角标计数严格一致（含废纸篓二次补计）。
- 未读计数随新邮件、已读状态变更、删除事件实时刷新（400 ms 节流）。

#### 2. 双击标签页关闭

双击邮件标签即可关闭，无需去点那个小 ✕。由实验性 API 在 `messenger.xhtml` 窗口挂载，
对已打开窗口和新开窗口都生效。

#### 3. AI 邮件翻译

- 邮件工具栏按钮 → 侧边/弹窗翻译界面，**逐段对照显示原文与译文**。
- 支持内联注入模式：译文直接插在原文段落下方。
- 多服务商可切换，**API Key 与模型由你自己填**（见下方「隐私」）。
- 内置术语/提示词自定义，可针对专业领域调优。

#### 4. 备忘录

- 左侧随手备忘录，支持多条笔记、自动保存。
- 可与邮件关联，从邮件右键菜单直接把要点摘进笔记。
- 图标可用项目自带的 SVG 素材替换。

### 安装

#### 方式一：下载 Release（推荐）

1. 到 [Releases](https://github.com/Awaker-OTE/thunderbird-plus/releases) 页面下载最新的 `.xpi` 文件。
2. Thunderbird → `工具` → `附加组件和主题` → 齿轮菜单 → `从文件安装附加组件…`
3. 选择刚下载的 `.xpi`。

#### 方式二：从源码临时加载

1. 克隆本仓库。
2. Thunderbird → `工具` → `开发者工具` → `调试附加组件` → `临时载入附加组件…`
3. 选择本仓库中的 `manifest.json`。

> 临时加载的扩展在 Thunderbird 重启后会失效，仅适合开发调试。

#### 方式三：自行打包

```bash
python3 scripts/package-extension.py
```

产物为仓库根目录下的 `thunderbird-interaction-enhancer.xpi`。

### 隐私与外部请求

**这一点请务必先读。**

本扩展的**所有 AI 翻译与模型调用都在你自己的机器上、用你自己的 API Key 发起**，
本扩展不收集、不上传任何遥测数据，也没有任何作者服务器中转。

但为了完成翻译，扩展会在你主动触发翻译时向**你在设置里填写的服务商**发送邮件正文。
manifest 中已声明以下网络权限，请按需选择服务商：

| 域名 | 用途 |
| --- | --- |
| `https://ark.cn-beijing.volces.com/*` | 火山方舟（豆包等模型） |
| `https://dashscope.aliyuncs.com/*` | 阿里云百炼（通义千问等模型） |
| `https://translation.googleapis.com/*` | Google Cloud Translation |
| `https://libretranslate.de/*` | LibreTranslate 公共实例 |
| `http://localhost/*`、`http://127.0.0.1/*` | 本地自建模型 / 代理 |

> 发送给第三方服务商的邮件内容受该服务商的隐私政策约束，与本项目无关。
> 涉及敏感邮件时，建议改用本地模型（localhost）或关闭翻译功能。

API Key 存储在 Thunderbird 本地扩展存储（`storage`）中，不会离开你的设备。

### 第三方组件

- 图标部分源自 [Lucide](https://lucide.dev)，按其许可证使用，见 [`thunderbird-interaction-enhancer/licenses/lucide-LICENSE.txt`](./thunderbird-interaction-enhancer/licenses/lucide-LICENSE.txt)。

### 许可证

本项目采用 [Mozilla Public License 2.0](./LICENSE)（MPL-2.0）。

简言之：你可以自由使用、修改、分发本项目，甚至用于商业用途；
但**你修改过的那部分文件必须继续以 MPL-2.0 开源**。未修改的文件可以被更大程度地自由组合使用。

### 贡献

Issue 与 PR 都欢迎。提交前请：

1. 说明复现步骤与 Thunderbird 版本（`帮助` → `关于 Thunderbird`）。
2. 若改动界面，附上截图。
3. 保持与现有代码风格一致（原生 JS，无构建步骤）。

---

## English

### What this is

Thunderbird Plus is an extension for **Thunderbird 128+** (Manifest V2 with an
experimental API). It bundles four everyday workflows that Thunderbird leaves
scattered across separate screens. It is not a theme and does not restyle the
UI — it only adds features.

### Features

#### 1. Unified unread panel

- A toolbar popup listing **unread mail from every account and every folder** at once.
- A **global unread count badge** on the toolbar icon, with the number also surfaced
  in the tooltip — so it stays readable even when the icon collapses into the overflow menu.
- Filter by account or folder, with a three-part summary line
  (`global unread N · current filter M · loaded K`) so a filtered view is never
  mistaken for the whole mailbox.
- One-click "mark all as read", using exactly the same counting rules as the badge
  (including a second pass for trash folders).
- Counts refresh in real time on new mail, read-state changes, and deletions
  (throttled to 400 ms).

#### 2. Double-click to close tabs

Double-click a message tab to close it. Handled by an experimental API attached to
`messenger.xhtml` windows, covering both existing and newly opened windows.

#### 3. AI mail translation

- A message-toolbar button opens a translation view with **side-by-side source and
  translated paragraphs**.
- Inline injection mode places the translation directly beneath each original paragraph.
- Multiple providers, with **your own API key and model** (see Privacy below).
- Custom system prompt / glossary for domain-specific tuning.

#### 4. Notes

- A side notebook with multiple notes and autosave.
- Can be linked to messages — push key points straight from the message context menu.
- Icon is swappable using the SVG assets shipped with the project.

### Installation

#### Option 1 — Release build (recommended)

1. Download the latest `.xpi` from [Releases](https://github.com/Awaker-OTE/thunderbird-plus/releases).
2. Thunderbird → `Tools` → `Add-ons and Themes` → gear menu → `Install Add-on From File…`
3. Pick the downloaded `.xpi`.

#### Option 2 — Load from source

1. Clone this repository.
2. Thunderbird → `Tools` → `Developer Tools` → `Debug Add-ons` → `Load Temporary Add-on…`
3. Select `manifest.json` in this repository.

> Temporary add-ons are dropped when Thunderbird restarts; this path is for development only.

#### Option 3 — Build the XPI yourself

```bash
python3 scripts/package-extension.py
```

The result is `thunderbird-interaction-enhancer.xpi` at the repository root.

### Privacy and external requests

**Please read this before installing.**

All AI translation and model calls are issued **from your own machine, with your own
API key**. This extension collects no telemetry, and no author-operated server is involved.

To translate, however, the extension sends message bodies to **whichever provider you
configure**. The following network permissions are declared in the manifest — choose
your provider accordingly:

| Domain | Purpose |
| --- | --- |
| `https://ark.cn-beijing.volces.com/*` | Volcengine Ark (Doubao and others) |
| `https://dashscope.aliyuncs.com/*` | Alibaba Cloud Bailian (Qwen and others) |
| `https://translation.googleapis.com/*` | Google Cloud Translation |
| `https://libretranslate.de/*` | Public LibreTranslate instance |
| `http://localhost/*`, `http://127.0.0.1/*` | Self-hosted models / local proxies |

> Content sent to a third-party provider is governed by that provider's privacy policy,
> which is outside this project's control. For sensitive mail, prefer a local model
> (localhost) or leave translation off.

API keys are kept in Thunderbird's local extension storage (`storage`) and never leave your device.

### Third-party components

- Some icons are derived from [Lucide](https://lucide.dev), used under its own license —
  see [`thunderbird-interaction-enhancer/licenses/lucide-LICENSE.txt`](./thunderbird-interaction-enhancer/licenses/lucide-LICENSE.txt).

### License

[Mozilla Public License 2.0](./LICENSE) (MPL-2.0).

In short: use, modify, and redistribute freely, including commercially — but
**files you modify must remain open under MPL-2.0**. Unmodified files can be
combined under broader terms.

### Contributing

Issues and pull requests are welcome. Before submitting:

1. Include reproduction steps and your Thunderbird version (`Help` → `About Thunderbird`).
2. Attach screenshots for any UI change.
3. Match the existing style (vanilla JS, no build step).
