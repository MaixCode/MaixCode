# MaixCode VS Code 扩展

[![DeepWiki Badge](https://img.shields.io/badge/More-DeepWiki-blue)
](https://deepwiki.com/MaixCode/MaixCode)

MaixCode 是一个用于 MaixCAM 设备开发的 VSCode 扩展，让您能够方便地开发、调试和运行 MaixPy 代码。通过此扩展，您可以发现网络上的 MaixCAM 设备，连接设备，运行和调试 Python 代码，并查看实时图像输出。

## 功能特性

- **设备发现与连接**：自动发现局域网内的 MaixCAM 设备并提供连接功能
- **实时图像预览**：通过 HTTP 或 WebSocket 实时查看设备摄像头输出
- **示例代码库**：内置示例代码，帮助快速开始开发
- **一键调试运行**：运行 Python 代码并查看输出结果
- **设备信息显示**：查看连接设备的系统信息、版本等

<!-- ![设备连接和图像预览](images/device-connect-preview.png) -->

## 安装要求

- VS Code 1.92.0 或更高版本
- 局域网中有 MaixCAM 设备
- 确保网络连接正常，设备与电脑在同一局域网内

## 使用方法

### 连接设备

1. 点击活动栏中的 MaixCode 图标打开设备面板
2. 在设备面板中可以看到自动发现的设备列表
3. 点击设备 IP 旁边的连接按钮进行连接
4. 或者使用"手动连接"选项，输入设备 IP 地址

### 查看实时图像

1. 打开 VS Code 右侧栏（Secondary Side Bar），选择 **MaixCode → Image**；或命令面板运行 "MaixCode: Open Image Viewer"
2. 在预览中选择已连接的设备，点击 Start（默认可自动开始）
3. 需要更大画面时，可用 "MaixCode: Open Image Viewer in Editor" 在编辑器旁打开面板
4. 勾选 **Hist** 在画面下方显示色彩直方图（每通道独立图，悬停查看详细数值），下拉选择 RGB / GRAY / LAB / YUV / HSV

### 运行代码

1. 打开需要运行的 Python 文件
2. 使用调试面板选择"MaixPy Debug"配置
3. 点击运行按钮将代码发送到设备执行
4. 查看调试控制台了解代码执行输出

### 浏览示例代码

1. 在扩展面板中，展开"Example"部分查看可用示例
2. 点击示例文件预览内容
3. 或者右键点击并选择"Open Source File"打开源文件

### 安装 Runtime

1. 连接设备后，在 Device 侧边栏 **Current Device Info** 中可查看 `Runtime` 版本
2. 点击 **Install Runtime**（或命令面板 `MaixCode: Install Runtime on Device`）
3. 扩展会从 Sipeed 查询最新版本并下载加密固件，经 WebSocket 安装到设备

<!-- ## 扩展设置

目前此扩展不提供配置选项。将在未来版本中添加以下设置：

- `maixcode.discovery.autoStart`: 启用/禁用自动设备发现
- `maixcode.discovery.interval`: 设备发现时间间隔（毫秒）
- `maixcode.imageViewer.refreshRate`: 图像预览刷新频率 -->

## 调试配置

在 `launch.json` 中，可以使用以下配置调试 MaixPy 程序：

```json
{
  "type": "maixpy",
  "request": "launch",
  "name": "MaixPy Debug",
  "program": "${file}"
}
```


## 语言 / Language

扩展界面跟随 VS Code 显示语言：

- **English**：默认（`package.nls.json` + 源码中的英文 `vscode.l10n.t` 字符串）
- **简体中文**：当 VS Code 显示语言为中文（`zh-cn`）时自动使用 `package.nls.zh-cn.json` 与 `l10n/bundle.l10n.zh-cn.json`

可在命令面板执行 **Configure Display Language** 切换。

## 已知问题

- 当多个设备同时连接时，可能需要手动选择当前活动设备
- 图像预览在某些网络环境下可能存在延迟
- WebSocket 连接模式在某些情况下可能不稳定

## 发布说明

<!-- ### 0.0.1

- 初始版本
- 实现设备发现与连接
- 添加图像预览功能
- 支持 MaixPy 代码运行和调试
- 集成示例代码浏览器 -->

---

## 关于 MaixCAM

MaixCAM 是 Sipeed 推出的 AIoT 开发板系列，主要用于计算机视觉和机器学习应用的开发。更多信息请访问 [Sipeed 官方网站](https://wiki.sipeed.com/hardware/zh/maixcam/index.html)。

**尽情使用 MaixCode 扩展进行开发吧！**
