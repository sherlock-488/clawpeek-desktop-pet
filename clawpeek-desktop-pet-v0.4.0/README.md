# ClawPeek 2D Desktop Pet / ClawPeek 2D 桌宠

## 中文

### 简介

ClawPeek 是一个基于 Electron 的 OpenClaw 桌宠插件。它会连接本地 OpenClaw Gateway，把会话状态映射成龙虾桌宠的动作和控制面板信息。

这一版的重点是：

- Gateway 连接放到 Electron 主进程，减少浏览器上下文带来的兼容问题
- 自动解析 Gateway URL、Token、Password 和 Control UI 地址
- OpenClaw 没启动时保持“休息中”，而不是误判成应用崩溃
- 单击可打开聊天入口，双击可打开控制面板，桌宠支持拖动

### 功能

- 2D 龙虾桌宠，按会话状态切换动画
- Electron 主进程直连 OpenClaw Gateway
- 支持 Token、Password、Device Token 自动回退
- 支持打开 Gateway Chat 或 CLI TUI
- 控制面板显示当前状态、模型信息、工具配置和最近日志
- 调试日志会尽量使用稳定英文标签，减少乱码

### 当前状态

桌宠当前使用的主状态如下：

- `offline`: 休息中
- `idle`: 空闲中
- `queued`: 排队中
- `thinking`: 思考中
- `tool`: 工具处理中
- `waiting`: 等待授权或确认
- `done`: 已完成
- `error`: 出错

其中 `tool` 状态还会细分 activity，例如：

- `search_web`
- `browse`
- `read`
- `search_code`
- `write`
- `edit`
- `exec`
- `attach`

### 快速开始

在当前目录运行：

```bash
npm install
npm start
```

运行测试：

```bash
npm test
```

### 作为 OpenClaw 扩展使用

1. 把项目放到 OpenClaw 扩展目录，例如：

```text
~/.openclaw/extensions/clawpeek-desktop-pet
```

2. 安装依赖：

```bash
cd ~/.openclaw/extensions/clawpeek-desktop-pet
npm install
```

3. 在 `~/.openclaw/openclaw.json` 中启用：

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

### 常用配置

- `gatewayUrl`: Gateway WebSocket 地址，默认自动推导
- `gatewayToken`: 手动指定共享 Token
- `gatewayTokenFile`: 从文件读取 Token
- `gatewayPassword`: 手动指定 Password
- `gatewayPasswordFile`: 从文件读取 Password
- `controlUiBaseUrl`: 手动指定 Control UI 地址
- `mainSessionKey`: 主会话 key，默认 `main`
- `clickAction`: `gateway-chat` 或 `cli-tui`
- `cliCommand`: 自定义 CLI TUI 命令模板
- `petCorner`: 桌宠默认出现位置
- `petSize`: 桌宠尺寸
- `dashboardWidth` / `dashboardHeight`: 控制面板尺寸
- `chatWidth` / `chatHeight`: 聊天窗口尺寸

`cliCommand` 可用占位符：

- `{{executable}}`
- `{{gatewayUrl}}`
- `{{sessionKey}}`
- `{{token}}`
- `{{password}}`
- `{{authArgs}}`

示例：

```json
{
  "extensions": {
    "clawpeek-desktop-pet": {
      "enabled": true,
      "clickAction": "cli-tui",
      "cliCommand": "{{executable}} tui --session {{sessionKey}} {{authArgs}}"
    }
  }
}
```

### 交互

- 左键拖动：移动桌宠
- 单击：按当前配置打开聊天入口
- 双击：打开控制面板
- 托盘菜单：显示/隐藏桌宠、打开聊天、打开控制面板、退出

### 项目结构

- `index.mjs`: OpenClaw 扩展入口，负责拉起 Electron
- `electron/main.cjs`: 主进程、窗口、托盘、IPC
- `electron/gateway-bridge.cjs`: Gateway 连接、认证、自动重连
- `electron/runtime.cjs`: 配置解析与默认值推导
- `renderer/pet.*`: 桌宠窗口
- `renderer/dashboard.*`: 控制面板
- `src/core/*`: 状态、reducer、store、常量
- `src/bridge/event-normalizer.js`: Gateway 事件归一化
- `src/pet/visual-state.js`: 状态到桌宠视觉的映射

### 调试

启动后最关键的排查点通常是：

- Gateway 是否真的在监听端口
- Token / Password 是否成功解析
- 日志里是否出现真实 tool 事件
- OpenClaw 关闭时桌宠是否回到 `offline`

### 验证

当前测试命令：

```bash
npm test
```

最近验证结果：`50` 项测试通过。

## English

### Overview

ClawPeek is an Electron-based desktop pet plugin for OpenClaw. It connects to the local OpenClaw Gateway and turns session state into lobster animations and dashboard status.

This version focuses on:

- moving the Gateway connection into the Electron main process
- resolving Gateway URL, token, password, and Control UI settings automatically
- treating a stopped OpenClaw instance as a resting pet instead of a crashed app
- keeping click, double-click, and drag behavior predictable

### Features

- 2D lobster desktop pet with state-driven animation
- direct Gateway connection from the Electron main process
- token, password, and device-token auth fallback
- opens either Gateway Chat or CLI TUI
- dashboard shows current state, model info, tool profile, and recent events
- debug logging prefers stable English labels to avoid garbled text

### Current States

Main pet states:

- `offline`
- `idle`
- `queued`
- `thinking`
- `tool`
- `waiting`
- `done`
- `error`

The `tool` state also carries activity detail such as:

- `search_web`
- `browse`
- `read`
- `search_code`
- `write`
- `edit`
- `exec`
- `attach`

### Quick Start

Run from this directory:

```bash
npm install
npm start
```

Run tests:

```bash
npm test
```

### OpenClaw Extension Setup

1. Place the project under your OpenClaw extensions directory, for example:

```text
~/.openclaw/extensions/clawpeek-desktop-pet
```

2. Install dependencies:

```bash
cd ~/.openclaw/extensions/clawpeek-desktop-pet
npm install
```

3. Enable it in `~/.openclaw/openclaw.json`:

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

### Common Configuration

- `gatewayUrl`: Gateway WebSocket URL, inferred by default
- `gatewayToken`: manually set shared token
- `gatewayTokenFile`: load token from file
- `gatewayPassword`: manually set password
- `gatewayPasswordFile`: load password from file
- `controlUiBaseUrl`: manually set Control UI base URL
- `mainSessionKey`: main session key, default `main`
- `clickAction`: `gateway-chat` or `cli-tui`
- `cliCommand`: custom CLI TUI command template
- `petCorner`: default pet corner
- `petSize`: pet size
- `dashboardWidth` / `dashboardHeight`: dashboard window size
- `chatWidth` / `chatHeight`: chat window size

Available `cliCommand` placeholders:

- `{{executable}}`
- `{{gatewayUrl}}`
- `{{sessionKey}}`
- `{{token}}`
- `{{password}}`
- `{{authArgs}}`

### Interaction

- drag with left mouse button: move the pet
- single click: open the configured chat entry
- double click: open the dashboard
- tray menu: show or hide the pet, open chat, open dashboard, quit

### Project Structure

- `index.mjs`: OpenClaw extension entrypoint
- `electron/main.cjs`: main process, windows, tray, IPC
- `electron/gateway-bridge.cjs`: Gateway connection, auth, reconnect logic
- `electron/runtime.cjs`: runtime config resolution
- `renderer/pet.*`: desktop pet window
- `renderer/dashboard.*`: dashboard UI
- `src/core/*`: state, reducer, store, constants
- `src/bridge/event-normalizer.js`: Gateway event normalization
- `src/pet/visual-state.js`: pet visual mapping

### Verification

Run:

```bash
npm test
```

Latest local verification: `50` tests passed.
