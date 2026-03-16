# ClawPeek Desktop Pet

<p align="right">
  <strong>Language:</strong>
  <a href="#中文">中文</a> |
  <a href="#english">English</a>
</p>

<a id="中文"></a>

## 中文

### 项目简介

ClawPeek Desktop Pet 是一个基于 Electron 的 OpenClaw 桌宠扩展。它会连接本地 OpenClaw Gateway，把会话状态、工具活动和连接状态映射成一只 2D 龙虾桌宠的动作和 UI 反馈。

这个项目的目标不是做一个独立聊天客户端，而是做一个“始终停留在桌面上的会话状态观察器”。当 OpenClaw 正在思考、调用工具、执行任务、完成任务、报错或离线时，桌宠和控制面板都会给出可视化反馈。

### 当前版本重点

当前仓库主要关注这些能力：

- Gateway 连接放在 Electron 主进程，减少渲染层直接连网带来的兼容问题
- 自动解析 Gateway URL、Control UI 地址、共享 Token 和 Password
- OpenClaw 未启动时，宠物保持休息或离线状态，而不是误判成应用崩溃
- 支持单击打开当前主聊天动作、双击打开控制面板、拖拽移动桌宠
- 尽量使用稳定英文调试标签，减少终端和日志中的乱码
- 保留足够详细的日志，便于判断上游是否真的触发了工具调用

### 仓库结构

当前仓库是“外层工作区 + 内层实际应用源码”的结构：

```text
clawpeek-desktop-pet/
├─ package.json
├─ README.md
├─ .gitignore
└─ clawpeek-desktop-pet-v0.4.0/
   ├─ package.json
   ├─ index.mjs
   ├─ openclaw.plugin.json
   ├─ electron/
   ├─ renderer/
   ├─ scripts/
   ├─ src/
   └─ tests/
```

结构说明：

- 根目录 `package.json` 提供统一入口命令，方便直接在仓库根目录执行 `npm start`、`npm test`
- `clawpeek-desktop-pet-v0.4.0/` 目录才是实际的 Electron 应用源码
- 本 README 是当前仓库唯一保留的项目说明文档

### 核心功能

- 2D 龙虾桌宠，按状态切换视觉表现
- Electron 主进程直接连接 OpenClaw Gateway
- 支持 `token`、`password`、`device token` 等认证路径
- 支持打开 Gateway Chat 或 CLI TUI
- 控制面板显示当前状态、会话、模型、工具活动和最近事件
- OpenClaw 关闭时宠物回到 `offline` / 休息态
- 工具活动可细分为搜索、浏览、读文件、写文件、执行命令等类别
- 调试日志会记录关键归一化事件，便于排查“是否真的联网/是否真的调用了工具”

### 运行环境

建议环境：

- Node.js 18 或更高版本
- npm 9 或更高版本
- 本机可访问的 OpenClaw Gateway
- Windows 是当前主要验证平台
- macOS 可以运行源码，但需要在目标机器重新安装依赖

### 快速开始

推荐直接在仓库根目录运行：

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

根目录命令说明：

- `npm run install:app`：为内层应用安装依赖
- `npm start`：启动 Electron 桌宠
- `npm run dev`：以更详细的日志启动
- `npm test`：运行内层应用测试

如果你直接进入 `clawpeek-desktop-pet-v0.4.0/`，也可以执行：

```powershell
npm install
npm start
```

### 作为 OpenClaw 扩展使用

1. 将项目放到 OpenClaw 扩展目录，例如：

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

### 配置项

常用扩展配置如下：

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `enabled` | 是否启用桌宠扩展 | `true` |
| `alwaysOnTop` | 桌宠窗口是否置顶 | `true` |
| `gatewayUrl` | Gateway WebSocket 地址，留空时自动推导 | `ws://127.0.0.1:18789` |
| `gatewayToken` | 手动指定共享 token | `""` |
| `gatewayTokenFile` | 从文件读取 token | `""` |
| `gatewayPassword` | 手动指定 password | `""` |
| `gatewayPasswordFile` | 从文件读取 password | `""` |
| `controlUiBaseUrl` | 手动指定 Control UI 地址 | `""` |
| `mainSessionKey` | 主会话 key | `"main"` |
| `clickAction` | 单击桌宠时打开 `gateway-chat` 或 `cli-tui`，也可通过托盘菜单切换 | `"gateway-chat"` |
| `cliCommand` | 自定义 CLI TUI 命令模板 | `""` |
| `petCorner` | 默认出现角落 | `"bottom-right"` |
| `petSize` | 桌宠尺寸 | `240` |
| `dashboardWidth` | 控制面板宽度 | `1120` |
| `dashboardHeight` | 控制面板高度 | `840` |
| `chatWidth` | 聊天窗口宽度 | `1260` |
| `chatHeight` | 聊天窗口高度 | `860` |

### 环境变量与认证来源

运行时也支持通过环境变量注入配置。常见项包括：

- `OPENCLAW_CONFIG_PATH`
- `PET_GATEWAY_URL`
- `PET_CONTROL_UI_BASE_URL`
- `PET_GATEWAY_TOKEN`
- `PET_GATEWAY_TOKEN_FILE`
- `OPENCLAW_GATEWAY_TOKEN`
- `PET_GATEWAY_PASSWORD`
- `PET_GATEWAY_PASSWORD_FILE`
- `OPENCLAW_GATEWAY_PASSWORD`
- `PET_MAIN_SESSION_KEY`
- `PET_ALWAYS_ON_TOP`
- `PET_CORNER`
- `PET_SIZE`
- `PET_DASHBOARD_WIDTH`
- `PET_DASHBOARD_HEIGHT`
- `PET_CHAT_WIDTH`
- `PET_CHAT_HEIGHT`
- `PET_CLICK_ACTION`
- `PET_CLI_COMMAND`

认证逻辑概览：

- 显式传入 `PET_GATEWAY_TOKEN` 或 `PET_GATEWAY_PASSWORD` 时，优先使用显式值
- 指定了 `*_FILE` 时，会从文件读取
- 没有显式配置时，会尝试从 OpenClaw 配置文件、`.env` 或环境变量中推导
- 自动模式会按可用认证方式回退，但也可以强制只试某一种方式

### `cliCommand` 模板占位符

自定义 `cliCommand` 时可使用：

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

### 桌宠状态

当前桌宠主状态如下：

| 状态 | 含义 |
| --- | --- |
| `offline` | OpenClaw 或 Gateway 不可用，宠物休息 |
| `idle` | 已连接，但当前没有活动任务 |
| `queued` | 已收到任务，正在准备处理 |
| `thinking` | 正在推理、生成或处理中间结果 |
| `tool` | 正在执行工具相关动作 |
| `waiting` | 正在等待结构化审批事件，不是普通聊天提问 |
| `done` | 当前轮任务完成，短暂停留后回到 `idle` |
| `error` | 连接或任务流程出现错误 |

补充说明：

- `done` 默认只停留约 `2.5` 秒
- `waiting` 只有在收到真正的审批请求事件时才会出现
- OpenClaw 关闭、Gateway 未监听或连接中断时，会回到 `offline`

### 工具活动分类

`tool` 状态下，项目还会继续细分 activity。当前常见类型包括：

- `search_web`
- `browse`
- `list`
- `read`
- `search_code`
- `write`
- `edit`
- `exec`
- `attach`
- `tool`
- `none`

这层分类适合驱动更细粒度的动画。例如：

- `search_web`：扫描或搜索感
- `read` / `search_code`：眼神扫读
- `write` / `edit`：钳子敲击
- `exec`：执行瞬时动作

### 交互方式

- 左键拖拽：移动桌宠
- 单击：按当前 `clickAction` 打开主聊天动作，默认是 Gateway Chat，也可以切到 CLI TUI
- 双击：打开控制面板
- 托盘菜单：显示或隐藏桌宠、切换单击动作、打开聊天、打开控制面板、退出

### 窗口与入口

项目主要暴露三个用户可见的界面或入口：

- 桌宠窗口：始终可见，展示龙虾状态和动效
- 控制面板：展示状态、会话、模型、工具活动和事件流
- 聊天入口：可打开 Gateway Chat 或 CLI TUI

### 关键模块

```text
clawpeek-desktop-pet-v0.4.0/
├─ index.mjs
├─ openclaw.plugin.json
├─ package.json
├─ electron/
│  ├─ main.cjs
│  ├─ gateway-bridge.cjs
│  ├─ runtime.cjs
│  ├─ debug-log.cjs
│  └─ debug-text.cjs
├─ renderer/
│  ├─ pet.html / pet.css / pet.js
│  └─ dashboard.html / dashboard.js
├─ src/
│  ├─ core/
│  ├─ bridge/
│  ├─ pet/
│  └─ ui/
├─ scripts/
└─ tests/
```

模块说明：

- `index.mjs`：OpenClaw 扩展入口，负责启动 Electron
- `electron/main.cjs`：主进程、窗口管理、托盘、IPC、打开聊天入口
- `electron/gateway-bridge.cjs`：Gateway 连接、认证和重连逻辑
- `electron/runtime.cjs`：运行时配置解析、默认值和环境变量处理
- `renderer/pet.*`：桌宠窗口
- `renderer/dashboard.*`：控制面板
- `src/core/*`：状态常量、reducer、store
- `src/bridge/event-normalizer.js`：把 Gateway 原始事件归一化为应用内部事件
- `src/pet/visual-state.js`：状态到桌宠视觉的映射
- `tests/*`：回归测试和调试逻辑测试

### 调试与排障

如果项目行为异常，优先检查以下几类问题：

1. Gateway 是否真的启动并监听端口  
   最常见的离线原因是 `127.0.0.1:18789` 无监听。

2. Token 或 Password 是否成功解析  
   如果认证配置不匹配，即使端口可用，也无法进入已连接状态。

3. 上游是否真的发出了结构化工具事件  
   回答文本里写“已搜索”不等于真的有 `tool_call`、`function_call` 或 `search_query` 事件。

4. OpenClaw 关闭时宠物是否回到 `offline`  
   当前代码已经把这类情况视为“休息态”，不是崩溃。

5. 调试日志是否仍出现乱码  
   项目已经把核心调试标签尽量转成稳定英文，但如果上游 payload 自身包含乱码文本，仍可能原样出现。

### 常见问题

#### 1. OpenClaw 没开时为什么宠物还在？

这是预期行为。应用本身仍在运行，只是网关不可用，所以宠物会显示休息或离线状态。

#### 2. 我明明让模型联网搜索了，为什么没有显示工具调用？

如果日志里没有结构化 `tool_call`、`function_call`、`web_search` 或 `search_query` 事件，那通常说明上游没有把这次搜索作为可观察工具事件发出来。

#### 3. Password 在哪里输入？

当前项目没有在控制面板里提供密码输入框。Password 需要通过 OpenClaw 配置或环境变量提供。

#### 4. `waiting` 状态什么时候会出现？

只有收到结构化审批请求事件时才会进入 `waiting`。普通聊天文本里的“要不要继续”不算。

### 开发与验证

开发模式：

```powershell
npm run dev
```

测试：

```powershell
npm test
```

当前本地基线：

- 测试命令：`npm test`
- 最近验证结果：`50` 项测试通过

### 后续可扩展方向

- 为 `tool` activity 增加更细分的动画
- 把桌宠动画资产抽象成统一的 `enter / loop / exit` 元数据
- 为仓库补正式 `LICENSE`
- 如果未来需要打包分发，可继续补充平台构建脚本

<a id="english"></a>

## English

### Overview

ClawPeek Desktop Pet is an Electron-based OpenClaw desktop pet extension. It connects to the local OpenClaw Gateway and maps session state, tool activity, and connectivity into the behavior of a 2D lobster pet and its UI.

The project is not intended to be a standalone chat client. Its main purpose is to act as a persistent desktop-side status observer. When OpenClaw is thinking, using tools, executing work, finishing runs, failing, or going offline, the pet and dashboard reflect that state.

### Current Focus

The current repository mainly focuses on:

- moving the Gateway connection into the Electron main process to reduce renderer-side networking issues
- automatically resolving the Gateway URL, Control UI URL, shared token, and password
- treating a stopped OpenClaw instance as a resting or offline pet instead of a crashed app
- supporting single-click primary chat action, double-click dashboard open, and drag-to-move interaction
- using stable English debug labels to reduce garbled terminal output
- keeping enough logging to verify whether upstream actually triggered tool calls

### Repository Layout

The repository currently uses a "workspace wrapper + nested application source" layout:

```text
clawpeek-desktop-pet/
├─ package.json
├─ README.md
├─ .gitignore
└─ clawpeek-desktop-pet-v0.4.0/
   ├─ package.json
   ├─ index.mjs
   ├─ openclaw.plugin.json
   ├─ electron/
   ├─ renderer/
   ├─ scripts/
   ├─ src/
   └─ tests/
```

What this means:

- the root `package.json` provides a single command entrypoint so you can run `npm start` and `npm test` from the repository root
- `clawpeek-desktop-pet-v0.4.0/` contains the actual Electron application source
- this README is now the only project documentation file kept in the repository

### Core Features

- 2D lobster desktop pet with state-driven visuals
- direct OpenClaw Gateway connection from the Electron main process
- support for `token`, `password`, and `device token` auth paths
- opens either Gateway Chat or CLI TUI
- dashboard shows current state, session, model, tool activity, and recent events
- when OpenClaw stops, the pet falls back to `offline` / resting
- tool activity can be classified into search, browse, read, write, exec, and related categories
- debug logs keep enough normalized detail to answer "did it actually search?" or "did it actually call a tool?"

### Requirements

Recommended environment:

- Node.js 18 or newer
- npm 9 or newer
- a locally reachable OpenClaw Gateway
- Windows is the main verified platform
- macOS can run the source, but dependencies must be installed on the target machine

### Quick Start

The recommended commands from the repository root are:

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

What the root commands do:

- `npm run install:app`: installs dependencies for the nested application
- `npm start`: launches the Electron desktop pet
- `npm run dev`: launches the app with more detailed logging
- `npm test`: runs the nested application's tests

If you are already inside `clawpeek-desktop-pet-v0.4.0/`, you can also run:

```powershell
npm install
npm start
```

### Using It as an OpenClaw Extension

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

### Configuration Reference

Common extension config fields:

| Key | Description | Default |
| --- | --- | --- |
| `enabled` | Enables the desktop pet extension | `true` |
| `alwaysOnTop` | Keeps the pet window on top | `true` |
| `gatewayUrl` | Gateway WebSocket URL, inferred when omitted | `ws://127.0.0.1:18789` |
| `gatewayToken` | Manually set shared token | `""` |
| `gatewayTokenFile` | Load token from file | `""` |
| `gatewayPassword` | Manually set password | `""` |
| `gatewayPasswordFile` | Load password from file | `""` |
| `controlUiBaseUrl` | Manually set Control UI base URL | `""` |
| `mainSessionKey` | Main session key | `"main"` |
| `clickAction` | Opens `gateway-chat` or `cli-tui` on single click; this can also be changed from the tray menu | `"gateway-chat"` |
| `cliCommand` | Custom CLI TUI command template | `""` |
| `petCorner` | Default screen corner | `"bottom-right"` |
| `petSize` | Pet size | `240` |
| `dashboardWidth` | Dashboard width | `1120` |
| `dashboardHeight` | Dashboard height | `840` |
| `chatWidth` | Chat window width | `1260` |
| `chatHeight` | Chat window height | `860` |

### Environment Variables and Auth Sources

Runtime config can also be injected through environment variables. Common values include:

- `OPENCLAW_CONFIG_PATH`
- `PET_GATEWAY_URL`
- `PET_CONTROL_UI_BASE_URL`
- `PET_GATEWAY_TOKEN`
- `PET_GATEWAY_TOKEN_FILE`
- `OPENCLAW_GATEWAY_TOKEN`
- `PET_GATEWAY_PASSWORD`
- `PET_GATEWAY_PASSWORD_FILE`
- `OPENCLAW_GATEWAY_PASSWORD`
- `PET_MAIN_SESSION_KEY`
- `PET_ALWAYS_ON_TOP`
- `PET_CORNER`
- `PET_SIZE`
- `PET_DASHBOARD_WIDTH`
- `PET_DASHBOARD_HEIGHT`
- `PET_CHAT_WIDTH`
- `PET_CHAT_HEIGHT`
- `PET_CLICK_ACTION`
- `PET_CLI_COMMAND`

High-level auth behavior:

- explicit `PET_GATEWAY_TOKEN` or `PET_GATEWAY_PASSWORD` values take precedence
- `*_FILE` values load credentials from disk
- when explicit values are missing, the app tries to infer values from OpenClaw config files, `.env`, or environment variables
- auto mode can fall back across available auth methods, but upstream logic can also force a single auth mode

### `cliCommand` Template Placeholders

When using a custom `cliCommand`, the following placeholders are available:

- `{{executable}}`
- `{{gatewayUrl}}`
- `{{sessionKey}}`
- `{{token}}`
- `{{password}}`
- `{{authArgs}}`

Example:

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

### Pet States

Current main pet states:

| State | Meaning |
| --- | --- |
| `offline` | OpenClaw or Gateway is unavailable, so the pet rests |
| `idle` | Connected, but currently not busy |
| `queued` | Work has arrived and is about to begin |
| `thinking` | The model is reasoning, generating, or producing intermediate output |
| `tool` | Tool-related work is in progress |
| `waiting` | A structured approval event is pending; this is not the same as plain chat text asking a question |
| `done` | The current run completed and will soon fall back to `idle` |
| `error` | The connection or task flow failed |

Additional notes:

- `done` currently lasts about `2.5` seconds
- `waiting` only appears when the app receives a real approval-request event
- when OpenClaw stops, the Gateway is not listening, or the connection breaks, the pet falls back to `offline`

### Tool Activity Classes

Inside the `tool` phase, the project also tracks more specific activity classes. Common values include:

- `search_web`
- `browse`
- `list`
- `read`
- `search_code`
- `write`
- `edit`
- `exec`
- `attach`
- `tool`
- `none`

This layer is useful for more granular animation design. For example:

- `search_web`: scanning or radar-like motion
- `read` / `search_code`: eye-tracking or reading motion
- `write` / `edit`: claw tapping
- `exec`: a short execution burst

### Interaction Model

- left-button drag: move the pet
- single click: open the current `clickAction`; default is Gateway Chat, but it can be switched to CLI TUI
- double click: open the dashboard
- tray menu: show or hide the pet, switch the single-click action, open chat, open the dashboard, quit

### Windows and Entrypoints

The project mainly exposes three user-facing surfaces:

- pet window: always-visible lobster state and animation
- dashboard: state, session, model, tool activity, and event stream
- chat entry: opens Gateway Chat or CLI TUI

### Key Modules

```text
clawpeek-desktop-pet-v0.4.0/
├─ index.mjs
├─ openclaw.plugin.json
├─ package.json
├─ electron/
│  ├─ main.cjs
│  ├─ gateway-bridge.cjs
│  ├─ runtime.cjs
│  ├─ debug-log.cjs
│  └─ debug-text.cjs
├─ renderer/
│  ├─ pet.html / pet.css / pet.js
│  └─ dashboard.html / dashboard.js
├─ src/
│  ├─ core/
│  ├─ bridge/
│  ├─ pet/
│  └─ ui/
├─ scripts/
└─ tests/
```

Module guide:

- `index.mjs`: OpenClaw extension entrypoint and Electron launcher
- `electron/main.cjs`: main process, window management, tray, IPC, chat launching
- `electron/gateway-bridge.cjs`: Gateway connection, auth, and reconnect logic
- `electron/runtime.cjs`: runtime config resolution, defaults, and env handling
- `renderer/pet.*`: pet window
- `renderer/dashboard.*`: dashboard UI
- `src/core/*`: constants, reducer, and state store
- `src/bridge/event-normalizer.js`: converts raw Gateway events into app-level events
- `src/pet/visual-state.js`: maps state to visual behavior
- `tests/*`: regression and debug-behavior tests

### Debugging and Troubleshooting

If the app behaves unexpectedly, start with these classes of problems:

1. Is the Gateway actually listening?  
   The most common offline condition is that `127.0.0.1:18789` is not accepting connections.

2. Were token or password values resolved correctly?  
   Even with a live port, bad auth config prevents the app from reaching a connected state.

3. Did upstream actually send structured tool events?  
   A text reply saying "I searched" is not the same as a real `tool_call`, `function_call`, or `search_query` event.

4. Does the pet return to `offline` when OpenClaw stops?  
   The current code intentionally treats this as resting, not as a crash.

5. Is there still garbled text in the logs?  
   Core debug labels are normalized toward stable English, but upstream payload text can still contain whatever upstream emitted.

### FAQ

#### 1. Why does the pet still exist when OpenClaw is not running?

That is expected. The application itself is still running; only the Gateway is unavailable, so the pet moves into a resting or offline state.

#### 2. I told the model to search the web. Why did no tool call appear?

If the logs do not contain structured `tool_call`, `function_call`, `web_search`, or `search_query` events, upstream likely did not emit an observable tool event for that request.

#### 3. Where do I enter a password?

This project does not currently expose a password form in the dashboard. Passwords are expected to come from OpenClaw config or environment variables.

#### 4. When does the `waiting` state appear?

Only when a structured approval-request event is received. Plain chat text such as "Should I continue?" does not trigger `waiting`.

### Development and Verification

Development mode:

```powershell
npm run dev
```

Tests:

```powershell
npm test
```

Current local baseline:

- command: `npm test`
- latest verified result: `50` tests passed

### Good Next Steps for Further Work

- add more granular animation variants for `tool` activities
- formalize animation assets around `enter / loop / exit` metadata
- add a proper repository `LICENSE`
- add platform build scripts if packaged distribution becomes necessary
