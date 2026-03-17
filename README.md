# ClawPeek Desktop Pet

<p align="right">
  <a href="#中文">中文</a> | <a href="#english">English</a>
</p>

## 中文

ClawPeek Desktop Pet 是一个围绕 OpenClaw 工作流可观测性做的桌面宠物扩展。它常驻桌面，把 Gateway 连接状态、会话进度、最近事件和当前活跃会话映射成龙虾动画与控制面板，让你在 OpenClaw 跑任务时去做别的事情，不用一直盯着聊天窗口。

### 适合做什么

- 在桌面侧持续观察 OpenClaw 是否在线、是否空闲、是否已经开始工作
- 快速判断当前是排队、处理中、等待批准、完成还是报错
- 在后台长时间跑任务时，用一个低打扰的可视化窗口看进度
- 通过事件流和日志判断这次到底有没有真实进入工具调用或执行链路

### 现在的 7 个主状态

| 状态 | 含义 |
| --- | --- |
| `offline` | OpenClaw 或 Gateway 不可用，龙虾休息 |
| `idle` | 已连接，但当前没有活跃任务 |
| `queued` | 已收到任务，正在等待正式开始 |
| `thinking` | 正在处理 OpenClaw 当前工作流 |
| `waiting` | 正在等待结构化授权或补充输入 |
| `done` | 最近一步已完成，会短暂停留后回到 `idle` |
| `error` | 最近一轮运行或连接出现错误 |

说明：

- 视觉主状态已经收敛为这 7 个。
- `tool` 不再作为独立主状态存在，工具调用会并入 `thinking`，但工具事件和 activity 记录仍然保留。

### 主要能力

- Electron 主进程直连 OpenClaw Gateway，降低渲染层直接联网的复杂度
- 桌宠窗口始终显示当前工作流状态，适合旁路观察
- 控制面板展示当前状态、当前会话、最近事件和连接信息
- OpenClaw 没开时显示为休息态，不把“后端未启动”误判成“应用崩溃”
- 保留调试日志，便于核对上游是否真的发出了结构化工具事件
- 支持从托盘打开 Gateway Chat 或 CLI TUI

### 快速开始

在仓库根目录运行：

```powershell
npm run install:app
npm start
```

开发模式：

```powershell
npm run dev
```

测试：

```powershell
npm test
```

### 基本使用方式

- 单击桌宠：打开控制面板
- 拖动桌宠：移动位置
- 托盘菜单：显示/隐藏桌宠、打开聊天入口、打开控制面板、退出

### 常用配置

最常用的是这些配置项：

| Key | 说明 | 默认值 |
| --- | --- | --- |
| `enabled` | 是否启用扩展 | `true` |
| `alwaysOnTop` | 桌宠是否置顶 | `true` |
| `gatewayUrl` | Gateway WebSocket 地址 | `ws://127.0.0.1:18789` |
| `mainSessionKey` | 主会话 key | `"main"` |
| `clickAction` | 托盘默认聊天入口动作，支持 `gateway-chat` / `cli-tui` | `"gateway-chat"` |
| `petCorner` | 默认停靠角落 | `"bottom-right"` |
| `petSize` | 桌宠尺寸 | `240` |
| `dashboardWidth` | 控制面板宽度 | `1120` |
| `dashboardHeight` | 控制面板高度 | `840` |

示例：

```json
{
  "extensions": {
    "clawpeek-desktop-pet": {
      "enabled": true,
      "alwaysOnTop": true,
      "mainSessionKey": "main",
      "petCorner": "bottom-right",
      "petSize": 240,
      "clickAction": "gateway-chat"
    }
  }
}
```

### 仓库结构

```text
clawpeek-desktop-pet/
|-- package.json
|-- README.md
|-- .gitignore
`-- clawpeek-desktop-pet-v0.4.0/
    |-- package.json
    |-- index.mjs
    |-- openclaw.plugin.json
    |-- electron/
    |-- renderer/
    |-- src/
    `-- tests/
```

说明：

- 根目录是统一入口，方便直接执行 `npm start` 和 `npm test`
- `clawpeek-desktop-pet-v0.4.0/` 是实际 Electron 应用源码

### 调试重点

排查时优先看这几类问题：

1. Gateway 是否真的在监听 `127.0.0.1:18789`
2. Token / Password 是否解析成功
3. 上游是否真的发出了结构化工具事件，而不是只在文本里说“我查了”
4. OpenClaw 关闭时，桌宠是否正常回到 `offline`

### 适用平台

- Windows：当前主要验证平台
- macOS：源码可运行，但需要在目标机器重新安装依赖

## English

ClawPeek Desktop Pet is a desktop pet extension focused on OpenClaw workflow observability. It stays on the desktop, turns Gateway connectivity, session progress, recent events, and the active session into lobster animation plus a compact control panel, so you can let OpenClaw work in the background while you keep doing something else.

### What It Is Good For

- keeping a low-friction view of whether OpenClaw is online, idle, or actively working
- seeing at a glance whether a run is queued, processing, waiting for approval, done, or failing
- monitoring long-running background tasks without camping in the chat window
- checking whether upstream actually entered a tool or execution path

### The 7 Main States

| State | Meaning |
| --- | --- |
| `offline` | OpenClaw or the Gateway is unavailable, so the lobster rests |
| `idle` | Connected, but currently not busy |
| `queued` | Work has arrived and is waiting to start |
| `thinking` | The current OpenClaw workflow is being processed |
| `waiting` | A structured approval or extra input is required |
| `done` | The latest step completed and will soon fall back to `idle` |
| `error` | The latest run or connection failed |

Notes:

- The visual state model is intentionally limited to these 7 states.
- `tool` is no longer a separate top-level pet state. Tool calls are folded into `thinking`, while tool events and activity tracking are still preserved.

### Core Value

- the Electron main process talks to the OpenClaw Gateway directly
- the pet window gives you an always-visible workflow signal
- the dashboard summarizes state, session, recent events, and connection status
- a stopped OpenClaw instance is treated as a resting pet, not as an app crash
- debug logs are preserved so you can verify whether upstream emitted a real structured tool event
- tray actions can open Gateway Chat or CLI TUI

### Quick Start

Run from the repository root:

```powershell
npm run install:app
npm start
```

Development mode:

```powershell
npm run dev
```

Tests:

```powershell
npm test
```

### Basic Interaction

- click the pet: open the dashboard
- drag the pet: move it
- tray menu: show or hide the pet, open chat entrypoints, open the dashboard, quit

### Common Config

| Key | Description | Default |
| --- | --- | --- |
| `enabled` | Enable the extension | `true` |
| `alwaysOnTop` | Keep the pet window on top | `true` |
| `gatewayUrl` | Gateway WebSocket URL | `ws://127.0.0.1:18789` |
| `mainSessionKey` | Main session key | `"main"` |
| `clickAction` | Default tray chat entrypoint, `gateway-chat` or `cli-tui` | `"gateway-chat"` |
| `petCorner` | Default corner | `"bottom-right"` |
| `petSize` | Pet size | `240` |
| `dashboardWidth` | Dashboard width | `1120` |
| `dashboardHeight` | Dashboard height | `840` |

Example:

```json
{
  "extensions": {
    "clawpeek-desktop-pet": {
      "enabled": true,
      "alwaysOnTop": true,
      "mainSessionKey": "main",
      "petCorner": "bottom-right",
      "petSize": 240,
      "clickAction": "gateway-chat"
    }
  }
}
```

### Repository Layout

```text
clawpeek-desktop-pet/
|-- package.json
|-- README.md
|-- .gitignore
`-- clawpeek-desktop-pet-v0.4.0/
    |-- package.json
    |-- index.mjs
    |-- openclaw.plugin.json
    |-- electron/
    |-- renderer/
    |-- src/
    `-- tests/
```

### Debugging Priorities

Start with these checks:

1. whether the Gateway is actually listening on `127.0.0.1:18789`
2. whether token or password resolution succeeded
3. whether upstream emitted a real structured tool event instead of only claiming it in text
4. whether the pet correctly falls back to `offline` when OpenClaw stops

### Platforms

- Windows: primary validated platform
- macOS: source should run, but dependencies must be installed again on the target machine
