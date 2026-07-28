# MaixCode 插件开发指南

MaixCode 插件系统允许开发者编写 JavaScript/TypeScript 插件来扩展开发环境的功能，包括设备交互、UI 面板、SSH 命令执行等。

---

## 目录

1. [快速开始](#快速开始)
2. [插件结构](#插件结构)
3. [maixplugin.json 清单文件](#maixpluginjson-清单文件)
4. [插件入口文件](#插件入口文件)
5. [宿主 API (DevicePluginHost)](#宿主-api-devicepluginhost)
6. [UI API](#ui-api)
7. [SSH API](#ssh-api)
8. [Webview 面板](#webview-面板)
9. [插件生命周期](#插件生命周期)
10. [调试与日志](#调试与日志)
11. [示例插件](#示例插件)
12. [插件发布与安装](#插件发布与安装)
13. [插件商场](#插件商场)
14. [最佳实践](#最佳实践)
15. [API 参考速查表](#api-参考速查表)

---

## 快速开始

### 最小插件结构

```
my-plugin/
├── maixplugin.json    # 插件清单（必需）
├── index.js           # 入口文件（必需）
└── view.js            # 可选的 webview 前端脚本
```

### maixplugin.json

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "index.js",
  "apiVersion": "1.0",
  "permissions": ["ui.panel", "ui.command"],
  "contributes": {
    "commands": [
      {
        "id": "my-plugin.hello",
        "title": "Say Hello"
      }
    ]
  }
}
```

### index.js — 入口文件

```javascript
module.exports = {
  manifest: {
    id: "com.example.my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    main: "index.js",
    apiVersion: "1.0",
    permissions: ["ui.panel", "ui.command"],
    contributes: {
      commands: [
        { id: "my-plugin.hello", title: "Say Hello" }
      ]
    }
  },

  activate(host) {
    host.log("activated");

    const disposable = host.ui.registerCommand("my-plugin.hello", async () => {
      await host.ui.showInformationMessage("Hello from my plugin!");
    });

    this._dispose = () => {
      disposable.dispose();
    };
  },

  deactivate() {
    if (this._dispose) {
      this._dispose();
      this._dispose = undefined;
    }
  }
};
```

### 导入插件

1. 打开 **Plugin Manager**（设备侧边栏 → 扩展图标，或命令 `MaixCode: Open Plugin Manager`）
2. 在 **Installed** 标签页点击 **Import Plugin**
3. 选择插件目录
4. 插件自动激活

---

## 插件结构

### 目录约定

```
my-plugin/
├── maixplugin.json    # 插件清单（必需，文件名固定）
├── index.js           # 入口文件（由 manifest.main 指定）
├── view.js            # webview 前端脚本
├── lib/               # 可选模块
│   └── utils.js
└── resources/         # 静态资源
    └── icon.png
```

### 文件规范

- 入口文件必须为 **CommonJS**（`module.exports`），使用 `require()` 加载依赖
- 所有文件必须在插件目录内，入口文件不能通过 `../` 逃逸到插件目录外
- 不支持 ES Module（`import`/`export`），请使用 `require()` 和 `module.exports`
- webview 前端脚本是纯浏览器 JS（`acquireVsCodeApi()`），不运行在 Node.js 环境

### 依赖管理

插件可以直接通过 `require()` 加载 Node.js 内置模块（`fs`、`path` 等）：

```javascript
const fs = require("fs");
const path = require("path");
```

第三方 npm 包不会被 webpack 打包到插件中。如果需要，建议在插件目录下放置 `node_modules` 或直接内联依赖代码。

---

## maixplugin.json 清单文件

### 完整 schema

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "index.js",
  "apiVersion": "1.0",
  "permissions": ["ui.panel", "ui.command"],
  "contributes": {
    "commands": [
      {
        "id": "my-plugin.hello",
        "title": "Say Hello"
      }
    ],
    "views": [
      {
        "id": "myPluginView",
        "name": "My Plugin View"
      }
    ]
  }
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 插件唯一 ID。必须匹配 `/^[a-zA-Z][a-zA-Z0-9._-]*$/` |
| `name` | string | 是 | 可读的插件名称 |
| `version` | string | 是 | 语义化版本号 |
| `main` | string | 是 | 入口文件路径（相对于插件目录） |
| `apiVersion` | string | 是 | 当前仅支持 `"1.0"` |
| `permissions` | string[] | 是 | 请求的权限列表（见下文） |
| `contributes.commands` | array | 否 | 插件贡献的命令列表 |
| `contributes.views` | array | 否 | 插件贡献的视图 ID |

### 权限列表

| 权限 | 说明 |
|------|------|
| `device.info` | 读取设备信息（型号、版本、API key 等） |
| `device.connection` | 监听设备连接/断开事件 |
| `device.frame` | 接收设备摄像头帧数据 |
| `device.imageFormat` | 设置设备图像格式（JPEG/PNG/None） |
| `device.run` | 在设备上执行 Python 代码 |
| `device.stop` | 停止设备上正在运行的代码 |
| `device.ws` | 直接 WebSocket 通信（暂未实现） |
| `device.runtime` | 安装/更新设备 Runtime |
| `ssh.shell` | 在设备上执行 SSH shell 命令 |
| `ssh.sftp` | SFTP 文件读写 |
| `ui.sidebar` | 打开侧边栏视图 |
| `ui.panel` | 创建 webview 面板 |
| `ui.command` | 注册 VS Code 命令 |
| `config.read` | 读取 MaixCode 配置 |
| `config.write` | 写入 MaixCode 配置 |

### 版本号校验

- `apiVersion` 当前仅接受 `"1.0"`
- `version` 使用语义化版本号（SemVer），格式为 `x.y.z`

---

## 插件入口文件

### 导出格式

插件入口必须通过 `module.exports` 导出一个 **DevicePlugin** 对象：

```javascript
module.exports = {
  manifest: { /* PluginManifest */ },
  activate(host) { /* ... */ },
  deactivate() { /* ... */ }
};
```

### `manifest`

与 `maixplugin.json` 内容一致，代码加载时会校验两者是否匹配（`id` 和 `apiVersion` 必须一致）。

### `activate(host: DevicePluginHost)`

插件激活时调用。`host` 提供所有 API 能力。可以：
- 注册命令
- 创建 webview 面板
- 监听设备事件
- 执行 SSH 命令

### `deactivate()`

插件停用时调用。应清理所有资源：
- 释放事件监听
- 销毁面板
- 清除定时器

### 生命周期状态

```
inactive → activate() → active → deactivate() → inactive
                                    ↓ (出错)
                                  error
```

- `inactive`：未激活
- `active`：已激活，正在运行
- `disabled`：用户禁用
- `error`：激活出错

---

## 宿主 API (DevicePluginHost)

### 概览

```typescript
interface DevicePluginHost {
  readonly apiVersion: "1.0";

  log(message: string): void;

  getCurrentDevice(): DevicePluginContext | undefined;
  getConnectedDevices(): DevicePluginContext[];

  onDidChangeDevice(listener: () => void): DevicePluginDisposable;
  onDidReceiveFrame(listener: (event: FrameEvent) => void): DevicePluginDisposable;
  onDidReceiveOutput(listener: (event: OutputEvent) => void): DevicePluginDisposable;

  execute(options: ExecuteOptions): Promise<ExecuteResult>;
  runCode(code: string): Promise<ExecuteResult>;
  stop(): Promise<void>;

  readonly ws: DevicePluginWs;
  readonly ssh: DevicePluginSsh;
  readonly image: DevicePluginImage;
  readonly ui: DevicePluginUi;
  readonly config: DevicePluginConfig;
}
```

### 设备上下文 (DevicePluginContext)

```typescript
interface DevicePluginContext {
  readonly key: string;        // 设备标识（name 或 ip）
  readonly name: string;       // 设备名称
  readonly ip: string;         // 设备 IP 地址
  readonly status: DeviceStatus; // "offline" | "online" | "running"
  readonly info?: DeviceInfo;  // 设备详细信息
  readonly capabilities: DeviceCapabilitySet;
  supports(capability: keyof DeviceCapabilitySet): boolean;
}
```

### 设备事件

```javascript
const disposable = host.onDidChangeDevice(() => {
  const device = host.getCurrentDevice();
  host.log(`Current device: ${device?.name || "none"}`);
});

const frameDisposable = host.onDidReceiveFrame((event) => {
  // event.deviceKey - 设备标识
  // event.image - Uint8Array 图像数据
});

const outputDisposable = host.onDidReceiveOutput((event) => {
  // event.deviceKey - 设备标识
  // event.text - 输出文本
});
```

### 设备控制

```javascript
// 执行 Python 代码
const result = await host.runCode("print('hello')");

// 停止运行
await host.stop();

// 执行代码（带目标设备）
await host.execute({ deviceKey: "my-device", code: "print('hello')" });
```

---

## UI API

`host.ui` 提供完整的 VS Code 界面交互能力。

### 消息提示

```javascript
// 信息提示
await host.ui.showInformationMessage("Plugin loaded");

// 警告提示
await host.ui.showWarningMessage("Something may be wrong");

// 错误提示
await host.ui.showErrorMessage("Something went wrong");

// 带按钮的提示
const result = await host.ui.showInformationMessage(
  "Choose an action",
  { title: "Open Panel" },
  { title: "Cancel", isCloseAffordance: true }
);
```

### 输入框

```javascript
const name = await host.ui.showInputBox({
  title: "Enter plugin name",
  value: "default-name",
  placeHolder: "Plugin name",
  prompt: "Enter a name for the plugin",
});
```

### 快速选择

```javascript
const picked = await host.ui.showQuickPick(
  [
    { label: "Option A", description: "Description A" },
    { label: "Option B", description: "Description B" },
  ],
  { placeHolder: "Select an option", matchOnDescription: true }
);
```

### 输出通道

```javascript
const channel = host.ui.createOutputChannel("My Plugin");
channel.appendLine("Log message");
channel.show();
```

### 国际化

```javascript
// 使用 VS Code 的本地化系统
const msg = host.ui.t("Hello, {0}!", "World");
// 中文环境下: "你好，World！"
```

### 文本编辑

```javascript
// 创建并打开文档
const doc = await host.ui.openTextDocument({
  language: "python",
  content: "print('hello')\n",
});
await host.ui.showTextDocument(doc, "beside");
```

### 扩展资源 URI

```javascript
// 获取扩展目录下的资源路径
const uri = host.ui.asExtensionUri("samples/my-plugin/view.js");
// 返回: "vscode-extension://cranyozen.maixcode-plg/samples/..."

// 在 createPanel 中通过 localResourceRoots 允许加载
```

### 命令注册

```javascript
const disposable = host.ui.registerCommand("my-plugin.do-something", async () => {
  await host.ui.showInformationMessage("Command executed!");
});
// 注意：运行时注册的命令不会出现在 VS Code 命令面板中，
// 但可以在插件管理器详情页点击 Run 执行
```

---

## SSH API

`host.ssh` 提供对已连接设备的 SSH 执行能力。

### 执行命令

```javascript
// 基本命令执行
const result = await host.ssh.exec("ps");

// 带选项
const result = await host.ssh.exec("ls -la /root", {
  cwd: "/root",          // 指定工作目录
  timeoutMs: 30000,      // 超时（毫秒）
});

console.log(result.code);      // 退出码（数字）
console.log(result.stdout);    // 标准输出（字符串）
console.log(result.stderr);    // 标准错误（字符串）
```

### 打开终端

```javascript
await host.ssh.openTerminal();
// 打开一个新的 VS Code 终端连接到设备
```

### 文件操作

```javascript
// 读取文件
const data = await host.ssh.readFile("/root/config.json");
const content = new TextDecoder().decode(data);

// 写入文件
const text = "hello world";
const bytes = new TextEncoder().encode(text);
await host.ssh.writeFile("/root/test.txt", bytes);
```

### 错误处理

```javascript
try {
  const result = await host.ssh.exec("some-command");
  if (result.code !== 0) {
    host.log(`Command failed: ${result.stderr}`);
  }
} catch (error) {
  host.log(`SSH error: ${error.message}`);
}
```

---

## Webview 面板

`host.ui.createPanel()` 创建包含自定义 HTML/JS 的 webview 面板。

### 创建面板

```javascript
const panel = host.ui.createPanel({
  viewType: "myPluginView",
  title: host.ui.t("My Plugin"),
  column: "beside",
  html: (webview) => getHtml(webview),
  onMessage: async (message, panel) => {
    host.log(`Received message: ${JSON.stringify(message)}`);
  },
  localResourceRoots: [
    "file://" + __dirname,  // 允许加载插件目录内的资源
  ],
});
```

### 前端与后端通信

**前端脚本**（view.js）：

```javascript
(function () {
  const vscode = acquireVsCodeApi();

  // 发送消息到后端
  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  document.getElementById("myBtn").addEventListener("click", () => {
    post("myAction");
  });

  // 接收后端消息
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      document.getElementById("output").textContent = message.text;
    }
  });

  post("ready");
})();
```

**后端处理**：

```javascript
const panel = host.ui.createPanel({
  viewType: "myPluginView",
  title: "My Plugin",
  column: "beside",
  html: (webview) => {
    const scriptUri = webview.asWebviewUri("file://" + path.join(__dirname, "view.js"));
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    button { font: inherit; border: none; border-radius: 8px; padding: 8px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
  </style>
</head>
<body>
  <button id="myBtn">Execute</button>
  <pre id="output"></pre>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  },
  onMessage: async (message) => {
    if (message.type === "ready") {
      await panel.webview.postMessage({ type: "state", text: "Connected" });
      return;
    }
    if (message.type === "myAction") {
      const result = await host.ssh.exec("some-command");
      await panel.webview.postMessage({ type: "state", text: result.stdout });
    }
  },
  localResourceRoots: ["file://" + __dirname],
});
```

### CSP 安全策略

Webview 必须设置 Content-Security-Policy（CSP）。推荐的最小配置：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}" />
```

- `default-src 'none'`：阻止所有未显式允许的资源
- `style-src ${webview.cspSource} 'unsafe-inline'`：允许 VS Code 的内联样式
- `script-src ${webview.cspSource}`：只允许加载 webview 脚本

### localResourceRoots

`localResourceRoots` 控制 webview 可以加载哪些本地文件。默认包含扩展的根目录。插件可以通过 `__dirname` 添加自己的目录：

```javascript
localResourceRoots: ["file://" + __dirname],
```

### 面板管理

```javascript
// 面板已创建，保存引用以便复用
let panel;

function openPanel() {
  if (!panel) {
    panel = host.ui.createPanel({
      viewType: "myPluginView",
      title: "My Plugin",
      column: "beside",
      html: (webview) => getHtml(webview),
      onMessage: async (message) => { /* ... */ },
    });
    panel.onDidDispose(() => {
      panel = undefined;   // 面板关闭时清理引用
    });
  } else {
    panel.reveal("beside"); // 已存在则聚焦
  }
}
```

---

## 插件生命周期

### 完整生命周期

```
加载 → 激活 → 运行 → 停用 → 卸载
```

| 阶段 | 触发时机 | 说明 |
|------|---------|------|
| 加载 | MaixCode 启动 / 导入插件 | 读取 `maixplugin.json`，`require()` 入口文件 |
| 激活 | 加载完成后 / 启用插件 | 调用 `activate(host)` |
| 运行 | 激活后 | 插件正常运行，响应事件和命令 |
| 停用 | 禁用 / 重载 / 移除插件 | 调用 `deactivate()` |
| 卸载 | 移除插件 | 从磁盘删除插件目录 |

### 激活顺序

1. 内置插件（shell_commands、threshold_editor）先注册
2. 本地已安装插件从 `globalStorage/plugins/<id>/` 加载
3. 所有已启用插件依次激活
4. 单个插件激活失败不影响其他插件

### 重载

```javascript
// 支持热重载：清除 require 缓存 → 重新加载 → 重新激活
// 在插件管理器中点击 Reload 按钮触发
```

---

## 调试与日志

### 日志输出

```javascript
// 插件日志自动带 [Plugin:<id>] 前缀
host.log("Plugin started");

// 日志输出到 MaixCode 的输出通道（View → Output → 选择 MaixCode）
```

### 常见问题

**插件未激活**

- 检查 `maixplugin.json` 格式是否正确
- 检查 `permissions` 是否包含所需权限
- 检查入口文件是否存在且语法正确
- 查看 MaixCode 输出通道中的错误信息

**webview 显示 401**

- 检查 `localResourceRoots` 是否包含所需资源目录
- 检查 CSP（Content-Security-Policy）是否正确配置
- 确认资源路径在允许的根目录内

**SSH 命令失败**

- 确认设备已连接且在线
- 检查 `maixcode.sshCredentials` 配置
- 确认插件有 `ssh.shell` 权限

---

## 示例插件

### Device Process List

完整示例在 `samples/device-process-list/` 目录。

**功能**：通过 SSH 执行 `ps` 命令并在 webview 中显示设备进程列表。

**组织结构**：

```
samples/device-process-list/
├── maixplugin.json    # 清单
├── index.js           # 后端入口
└── view.js            # 前端脚本
```

**关键代码**：

`index.js` 中创建面板并执行 SSH：

```javascript
const panel = host.ui.createPanel({
  viewType: "sampleDeviceProcessList",
  title: host.ui.t("Device Process List"),
  column: "beside",
  html: (webview) => getHtml(webview),
  onMessage: async (message) => {
    if (message.type === "ready") {
      await postState(panel, host, state);
      return;
    }
    if (message.type === "refresh") {
      const device = host.getCurrentDevice();
      if (!device) return;
      const result = await host.ssh.exec("ps");
      state.output = result.stdout;
      await postState(panel, host, state);
    }
  },
  localResourceRoots: ["file://" + __dirname],
});
```

`view.js` 中接收状态并渲染：

```javascript
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type !== "state") return;
  document.getElementById("output").textContent = message.state.output || "";
});
```

---

## 插件发布与安装

### 本地导入

1. 在插件管理器中点击 **Import Plugin**
2. 选择插件目录
3. 插件被复制到 `{globalStorage}/plugins/{id}/` 并激活

### 插件商场

MaixCode 支持从插件商场安装插件。商场配置在 `maixcode.pluginMarketplaces` 中：

```json
[
  {
    "id": "official",
    "label": "Official",
    "type": "github",
    "owner": "MaixCode",
    "repo": "Plugin-Marketplace",
    "path": "index.json"
  }
]
```

### 发布到商场

要发布插件到官方商场：

1. Fork 或创建 PR 到 [MaixCode/Plugin-Marketplace](https://github.com/MaixCode/Plugin-Marketplace)
2. 在 `index.json` 中添加插件条目，支持四种分发方式：

```json
{
  "plugins": [
    {
      "id": "com.example.my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "description": "Description",
      "author": { "name": "Author", "url": "https://github.com/author" },
      "apiVersion": "1.0",
      "permissions": ["ui.panel", "ui.command"],
      "source": {
        "type": "path",
        "path": "plugins/my-plugin"
      }
    }
  ]
}
```

### 四种分发方式

| type | 说明 | source 字段 |
|------|------|-------------|
| `path` | 商场仓库内的子目录 | `path: "plugins/hello-world"` |
| `github-repo` | 外部 GitHub 仓库的路径 | `owner, repo, ref?, path?` |
| `github-release` | GitHub release 资产 | `owner, repo, release: { tag?, asset }` |
| `http` | 直接 HTTP(S) 下载 | `url: "https://example.com/plugin.zip"` |

---

## 插件商场

### 商场配置

`maixcode.pluginMarketplaces` 数组定义多个商场源：

```json
[
  {
    "id": "official",
    "label": "Official Plugins",
    "type": "github",
    "owner": "MaixCode",
    "repo": "Plugin-Marketplace",
    "path": "index.json",
    "ref": "main"
  },
  {
    "id": "community",
    "label": "Community",
    "type": "http",
    "url": "https://example.com/marketplace.json"
  }
]
```

### 商场索引格式

每个商场源指向一个 JSON 文件，格式如下：

```json
{
  "version": 1,
  "updatedAt": "2026-07-27T00:00:00Z",
  "plugins": [
    {
      "id": "com.example.hello-world",
      "name": "Hello World",
      "version": "1.0.0",
      "description": "A simple hello world plugin",
      "author": { "name": "Author" },
      "apiVersion": "1.0",
      "permissions": ["ui.panel", "ui.command"],
      "source": {
        "type": "path",
        "path": "plugins/hello-world"
      }
    }
  ]
}
```

### 在商场中更新插件

当商场索引中的 `version` 高于已安装版本时，插件管理器会显示 **Update** 角标。用户点击 **Update** 按钮后，最新版本会被下载并重新安装。

---

## 最佳实践

### 插件设计

1. **无设备也工作**：插件应能在无设备时打开并显示空态，设备连接后自动开始功能
2. **清理资源**：`deactivate()` 中释放所有监听器和面板
3. **ID 命名**：使用反向域名风格（`com.example.my-plugin`），避免冲突
4. **最小权限**：只申请实际需要的权限
5. **日志记录**：关键操作使用 `host.log()` 记录，便于调试

### Webview 开发

1. **使用 `onDidDispose`**：面板关闭时清理引用，允许重新创建
2. **单例面板**：避免重复创建面板，复用已有实例
3. **CSP 安全**：始终设置 Content-Security-Policy
4. **消息通信**：前后端通过 `postMessage`/`onDidReceiveMessage` 通信
5. **资源路径**：外部 JS/CSS 文件要包含在 `localResourceRoots` 中

### SSH 命令

1. **超时设置**：长时间命令设置合理的 `timeoutMs`
2. **错误处理**：检查 `result.code` 和处理 `stderr`
3. **会话管理**：每个 `host.ssh.exec()` 创建独立 SSH 会话，不需要手动清理
4. **文件操作**：`readFile`/`writeFile` 通过 base64 编码传输，适用小文件

### 错误处理

```javascript
async function safeOperation(host) {
  try {
    const result = await host.ssh.exec("some-command");
    return result;
  } catch (error) {
    host.log(`Operation failed: ${error.message}`);
    await host.ui.showErrorMessage(`Failed: ${error.message}`);
    return null;
  }
}
```

---

## API 参考速查表

### DevicePluginHost

| 方法 | 返回值 | 说明 |
|------|--------|------|
| `log(message)` | `void` | 写入插件日志 |
| `getCurrentDevice()` | `DevicePluginContext \| undefined` | 获取当前设备 |
| `getConnectedDevices()` | `DevicePluginContext[]` | 获取所有已连接设备 |
| `onDidChangeDevice(listener)` | `Disposable` | 设备列表变化事件 |
| `onDidReceiveFrame(listener)` | `Disposable` | 图像帧事件 |
| `onDidReceiveOutput(listener)` | `Disposable` | 输出文本事件 |
| `runCode(code)` | `Promise<ExecuteResult>` | 在设备上运行代码 |
| `stop()` | `Promise<void>` | 停止设备运行 |
| `execute(options)` | `Promise<ExecuteResult>` | 执行代码（带设备选择） |

### host.ws

| 方法 | 说明 |
|------|------|
| `send(command, payload)` | 发送 WebSocket 命令（暂未实现） |
| `request<T>(command, payload?)` | 请求-响应模式（暂未实现） |

### host.ssh

| 方法 | 说明 |
|------|------|
| `exec(command, options?)` | 执行 SSH 命令，返回 `{ code, stdout, stderr }` |
| `openTerminal()` | 打开 SSH 终端 |
| `readFile(path)` | 读取远程文件，返回 `Uint8Array` |
| `writeFile(path, data)` | 写入远程文件 |

### host.image

| 方法 | 说明 |
|------|------|
| `setFormat(format)` | 设置图像格式（"JPEG" \| "PNG" \| "none"） |
| `subscribe(deviceKey?)` | 订阅图像帧（暂未实现） |
| `getLatestFrame(deviceKey?)` | 获取最新帧数据 |

### host.ui

| 方法 | 说明 |
|------|------|
| `openSidebar(viewId)` | 打开侧边栏视图 |
| `openPanel(viewId)` | 打开面板 |
| `showInformationMessage(msg, ...items)` | 信息提示 |
| `showWarningMessage(msg, ...items)` | 警告提示 |
| `showErrorMessage(msg, ...items)` | 错误提示 |
| `showInputBox(options)` | 输入框 |
| `showQuickPick(items, options)` | 快速选择 |
| `createOutputChannel(name)` | 创建输出通道 |
| `asExtensionUri(path)` | 获取扩展内资源 URI |
| `openTextDocument(options)` | 打开文本文档 |
| `showTextDocument(doc, column?, preserveFocus?)` | 显示文档 |
| `t(message, ...args)` | 国际化翻译 |
| `createPanel(options)` | 创建 webview 面板 |
| `registerCommand(id, handler)` | 注册命令 |

### host.config

| 方法 | 说明 |
|------|------|
| `get<T>(key)` | 读取配置 |
| `update<T>(key, value)` | 写入配置 |

### Disposable

所有事件订阅返回 `Disposable` 对象，调用 `dispose()` 取消订阅。

```javascript
const disposable = host.onDidChangeDevice(() => { /* ... */ });
// 清理：
disposable.dispose();
```
