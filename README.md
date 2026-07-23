# MaixCode — MaixCAM 开发扩展

[![DeepWiki Badge](https://img.shields.io/badge/More-DeepWiki-blue)](https://deepwiki.com/MaixCode/MaixCode)

[中文] | [English](README-en.md)

MaixCode 是 VS Code 的 MaixCAM / MaixPy 开发扩展，让您在编辑器内完成设备发现、连接、代码运行调试、实时图像预览、SSH 终端、SFTP 文件管理等全流程开发。

---

## 功能特性

- **设备发现与连接** — mDNS 自动扫描局域网内 MaixCAM 设备，支持手动连接和自动连接
- **代码运行与调试** — 一键将 Python 文件发送到设备执行，支持文件模式和项目模式
- **实时图像预览** — HTTP / WebSocket / MJPEG 三种传输模式查看设备摄像头画面，支持缩放平移、截图保存
- **色彩直方图** — 实时 RGB / GRAY / LAB / YUV / HSV 通道直方图，支持悬停查看详细数值
- **SSH 终端** — 内置 SSH 终端，直接操作设备命令行
- **SFTP 文件管理** — 虚拟文件系统挂载设备目录，在 VS Code 资源管理器中直接管理设备文件
- **项目打包部署** — 通过 `app.yaml` 配置项目，打包 zip 并安装到设备运行
- **Runtime 安装** — 从 Sipeed 云端获取并安装 MaixVision Runtime
- **多源示例代码** — 支持官方 CDN（sipeed）、本地文件夹、GitHub 仓库三种示例源

---

## 安装要求

- VS Code **1.92.0** 或更高版本
- 与 MaixCAM 设备在同一局域网内
- 设备需开启 SSH 服务（默认端口 22）

---

## 快速开始

### 连接设备

1. 点击活动栏的 **MaixCode** 图标（`$(circuit-board)`），打开设备面板
2. 扩展自动发现局域网内设备（主机名前缀 `maixcam`），也可手动输入 IP 连接
3. 设备前圆点状态灯：<span style="color:gray">⚫</span> 离线 / <span style="color:green">🟢</span> 在线 / <span style="color:orange">🟠</span> 已连接

### 运行代码

- **运行当前文件**：打开 Python 编辑器，点击标题栏 ▶ 或命令面板 `MaixCode: Run Current File on Device`
- **运行项目**：命令面板 `MaixCode: Run Project on Device`（自动打包 → 部署 → 运行）
- F5 调试面板提供 **MaixPy Debug** 配置，支持文件模式和项目模式

### 查看实时图像

1. 在设备侧边栏 **当前设备信息** 下点击 **打开图像预览**，或打开右侧栏 → **MaixCode** → **Image**，或命令 `MaixCode: Open Image Viewer`
2. 选择已连接设备，点击 **Start**（连接后默认自动开始）
3. 工具栏可切换 HTTP / WS / MJPEG 模式、启停、截图保存
4. 勾选 **Hist** 显示色彩直方图，下拉切换色彩空间
5. 画面支持**滚轮缩放**、**拖拽平移**、**双击重置**

### SSH 终端

- 在设备列表中点击设备 IP 右侧的终端图标，或命令 `MaixCode: Open SSH Terminal`
- 凭据通过 `maixcode.sshCredentials` 配置，依次尝试直到成功（默认 `root` / `root` 或 `root` / `sipeed`）

### SFTP 文件管理

- 点击设备文件夹图标或命令 `MaixCode: Open Device Files (SFTP)`
- 设备文件以 `maixsftp://` 虚拟文件系统挂载到工作区
- 支持创建、编辑、删除、重命名设备文件（可设为只读）
- 右键文件夹/文件可**过滤隐藏**条目；`sftpHidePatterns` 支持 glob 和正则

### 项目打包部署

1. 在文件夹右键或命令面板选择 `MaixCode: Configure Project (app.yaml)` 创建配置
2. `app.yaml` 包含 id、名称、版本、入口文件等信息
3. 使用 **Package App** 打包为 `dist/maix-{id}-v{version}.zip`
4. 使用 **Install App** 或 **Package and Install App** 部署到设备

### 浏览示例代码

- 在 **Example** 面板查看多源示例（`maixcode.exampleSources` 配置）
- 点击文件以 `example://` 虚拟编辑器打开（安全编辑，保存时需另存）
- 右键 → **Open Source File** 打开实际缓存文件（刷新可能覆盖）
- 支持示例源类型：`sipeed`（官方 CDN）、`local_folder`（本地目录）、`github_repo`（GitHub 仓库）

---

## 调试配置

`launch.json` 示例：

```json
{
  "type": "maixpy",
  "request": "launch",
  "name": "MaixPy: Run Current File",
  "program": "${file}"
}
```

项目模式：

```json
{
  "type": "maixpy",
  "request": "launch",
  "name": "MaixPy: Run Project",
  "program": "${workspaceFolder}",
  "mode": "project",
  "projectDir": "${workspaceFolder}"
}
```

---

## 扩展设置

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `maixcode.enableDeviceDiscovery` | `true` | 启用 mDNS 设备发现 |
| `maixcode.autoConnect` | `true` | 发现设备后自动连接 |
| `maixcode.autoConnectTarget` | `""` | 首选自动连接设备（主机名或 IP） |
| `maixcode.imageServicePort` | `9090` | 本地图像服务端口（0=临时端口） |
| `maixcode.imageViewerDefaultMode` | `"websocket"` | 图像预览默认传输方式 |
| `maixcode.imageHttpIntervalMs` | `33` | HTTP 轮询间隔（毫秒） |
| `maixcode.imageViewerAutoStart` | `true` | 打开预览且有设备时自动开始推流 |
| `maixcode.autoOpenImageViewer` | `true` | 连接后自动打开图像预览侧栏 |
| `maixcode.sshPort` | `22` | SSH 端口 |
| `maixcode.sshConnectTimeoutMs` | `10000` | SSH 连接超时 |
| `maixcode.sshCredentials` | `root`/`root`, `root`/`sipeed` | SSH 凭据列表（按序尝试） |
| `maixcode.autoOpenSftp` | `true` | 连接后自动打开 SFTP |
| `maixcode.sftpReadOnly` | `false` | SFTP 只读模式 |
| `maixcode.sftpHidePatterns` | — | 隐藏匹配的 SFTP 条目 |
| `maixcode.sftpShowFiltered` | `false` | 显示已过滤条目（带 H 角标） |
| `maixcode.sftpBookmarks` | Root、Home | SFTP 书签文件夹 |
| `maixcode.exampleSources` | Official | 示例源配置 |
| `maixcode.githubToken` | `""` | GitHub 私有仓库 Token |

---

## 语言 / Language

扩展界面跟随 VS Code 显示语言：

- **English**：默认（`package.nls.json` + 源码英文 `vscode.l10n.t` 字符串）
- **简体中文**：VS Code 显示语言切换为 `zh-cn` 后自动使用

命令面板执行 **Configure Display Language** 切换。

---

## 已知问题

- 多设备同时连接时，当前活动设备的切换可能需手动操作
- 网络环境不佳时图像预览可能有延迟
- WebSocket 连接在某些条件下可能不稳定

---

## 开发

```bash
yarn install          # 安装依赖
yarn run compile      # webpack → dist/extension.js
yarn run watch        # webpack watch（F5 调试用）
yarn run lint         # ESLint
yarn run test         # 运行测试
yarn run package:vsix # 打包 VSIX
```

F5 启动扩展开发主机进行调试。详见 [AGENTS.md](AGENTS.md)。

---

## 关于 MaixCAM

MaixCAM 是 Sipeed 推出的 AIoT 开发板系列，面向计算机视觉和机器学习应用。更多信息访问 [Sipeed Wiki](https://wiki.sipeed.com/hardware/zh/maixcam/index.html)。

**享受使用 MaixCode 编程的乐趣！**
