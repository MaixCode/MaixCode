# MaixCode VS Code 扩展

[![DeepWiki Badge](https://img.shields.io/badge/More-DeepWiki-blue)](https://deepwiki.com/MaixCode/MaixCode)
[![Version](https://img.shields.io/badge/version-0.0.1-green.svg)](https://github.com/MaixCode/MaixCode)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue.svg)](https://marketplace.visualstudio.com/items?itemName=Cranyozen.maixcode)

> **语言**: [English](README.md) | [简体中文](README_zh.md)

<div align="center">
  <img src="resources/maixcode.svg" alt="MaixCode Logo" width="128" height="128">
</div>

MaixCode 是一个为 MaixCAM 设备开发设计的强大 Visual Studio Code 扩展。它为 MaixPy 应用程序提供了全面的开发环境，支持无缝设备发现、实时调试、实时图像流传输，以及直接在 MaixCAM 硬件上执行代码。

<!-- 截图将在未来版本中添加 -->
<!-- ![设备发现](docs/images/device-discovery.png) -->
<!-- ![图像流传输](docs/images/image-streaming.png) -->
<!-- ![代码调试](docs/images/code-debugging.png) -->

## ✨ 核心功能

- 🔍 **自动设备发现**：自动检测本地网络上的 MaixCAM 设备
- 📱 **实时图像流传输**：通过 HTTP/WebSocket 查看连接设备的实时摄像头画面
- 🐛 **集成调试**：对 MaixPy 应用程序的完整调试支持
- 📚 **内置示例**：全面的示例库帮助您快速开始
- ⚡ **一键执行**：直接在设备上运行 Python 代码并获得即时反馈
- 📊 **设备信息**：监控设备状态、系统信息和性能指标
- 🔧 **可视化界面**：用于设备管理和示例的直观侧边栏面板

## 🚀 快速开始

1. **安装扩展**：在 VS Code 扩展市场中搜索 "MaixCode"
2. **连接设备**：确保您的 MaixCAM 设备在同一网络上
3. **打开设备面板**：点击活动栏中的 MaixCode 图标
4. **开始开发**：选择一个示例或编写您自己的 MaixPy 代码

## 📋 目录

- [安装和要求](#-安装和要求)
- [入门指南](#-入门指南)
- [设备管理](#-设备管理)
- [图像流传输](#-图像流传输)
- [代码开发和调试](#-代码开发和调试)
- [示例浏览器](#-示例浏览器)
- [命令参考](#-命令参考)
- [配置](#-配置)
- [故障排除](#-故障排除)
- [贡献](#-贡献)
- [关于 MaixCAM](#-关于-maixcam)

## 📦 安装和要求

### 前提条件

- **VS Code**：版本 1.92.0 或更高
- **Node.js**：版本 16 或更高（用于开发）
- **MaixCAM 设备**：连接到同一本地网络
- **网络访问**：确保 PC 和设备之间的网络连接正常

### 安装方法

#### 从 VS Code 市场安装
1. 打开 VS Code
2. 转到扩展 (Ctrl+Shift+X)
3. 搜索 "MaixCode"
4. 点击 Cranyozen 的扩展上的"安装"

#### 从 VSIX 文件安装
1. 从 [Releases](https://github.com/MaixCode/MaixCode/releases) 下载最新的 `.vsix` 文件
2. 打开 VS Code 命令面板 (Ctrl+Shift+P)
3. 运行 "Extensions: Install from VSIX..."
4. 选择下载的文件

#### 开发安装
```bash
git clone https://github.com/MaixCode/MaixCode.git
cd MaixCode
yarn install
yarn run compile
# 按 F5 打开一个加载了扩展的新 VS Code 窗口
```

### 验证
安装后，您应该在 VS Code 活动栏中看到 MaixCode 图标 (🔧)。

## 🎯 入门指南

### 首次设置

1. **激活扩展**：打开 VS Code 并点击活动栏中的 MaixCode 图标
2. **检查设备面板**："设备"面板将自动开始发现 MaixCAM 设备
3. **验证网络**：确保您的 MaixCAM 设备和 PC 在同一网络上
4. **连接设备**：点击任何发现设备旁边的连接按钮 (🔗)

### 您的第一个 MaixPy 程序

1. **浏览示例**：展开"示例"面板查看可用的代码示例
2. **打开示例**：点击任何示例进行预览，或右键点击 → "打开源文件"
3. **运行代码**：使用调试面板的 "MaixPy Debug" 配置
4. **查看输出**：检查调试控制台了解执行结果

## 🔌 设备管理

### 自动发现

扩展使用 mDNS 自动扫描本地网络中的 MaixCAM 设备。发现的设备会在"设备"面板中显示：
- IP 地址
- 设备名称
- 连接状态
- 最后发现时间

### 手动连接

如果自动发现不起作用：
1. 打开命令面板 (Ctrl+Shift+P)
2. 运行 "MaixCode: Connect Device"
3. 手动输入设备 IP 地址
4. 点击"连接"

### 设备操作

| 操作 | 描述 | 访问方式 |
|--------|-------------|---------------|
| 连接 | 建立到设备的连接 | 点击设备 IP 旁边的 🔗 |
| 断开连接 | 关闭活动连接 | 命令面板 → "MaixCode: Disconnect Device" |
| 刷新 | 重新扫描设备 | 点击设备面板中的刷新按钮 |
| 信息 | 查看设备系统信息 | 连接后可用 |

### 连接状态

- 🟢 **已连接**：设备活动且就绪
- 🟡 **连接中**：连接进行中
- 🔴 **已断开连接**：没有活动连接
- ⚫ **未找到**：设备不可达

## 📹 图像流传输

### 实时摄像头画面

MaixCode 提供来自 MaixCAM 设备摄像头的实时图像流传输：

1. **打开图像查看器**：
   - 命令面板 (Ctrl+Shift+P) → "MaixCode: Open Image Viewer"
   - 或点击设备面板中的摄像头图标

2. **选择设备**：从下拉菜单中选择您连接的设备

3. **选择流模式**：
   - **HTTP 模式**：标准 HTTP 请求（更稳定）
   - **WebSocket 模式**：实时流传输（更低延迟）

### 图像查看器功能

- **实时预览**：可配置刷新率的实时摄像头画面
- **截图捕获**：将当前帧保存为图像文件
- **流控制**：启动/停止流传输并提供视觉反馈
- **性能指标**：查看 FPS、延迟和连接状态
- **质量设置**：调整图像质量和压缩
- **全屏模式**：展开查看器以获得更好的可见性

### 流传输配置

| 设置 | 描述 | 默认值 | 范围 |
|---------|-------------|---------|-------|
| 刷新间隔 | 更新频率（毫秒） | 100ms | 50-1000ms |
| 图像质量 | JPEG 压缩级别 | 85% | 50-100% |
| 分辨率 | 图像尺寸 | 设备默认 | 取决于设备 |

### 流传输故障排除

- **无图像**：检查设备摄像头权限和连接
- **高延迟**：尝试减少刷新间隔或图像质量
- **连接中断**：从 WebSocket 切换到 HTTP 模式
- **画质差**：增加 JPEG 质量或检查网络带宽

## 🐛 代码开发和调试

### MaixPy 调试配置

MaixCode 包含专门用于 MaixPy 应用程序的调试器：

#### 启动配置

将此添加到您的 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "maixpy",
      "request": "launch",
      "name": "MaixPy Debug",
      "program": "${file}"
    },
    {
      "type": "maixpy",
      "request": "launch", 
      "name": "MaixPy Debug (Current Folder)",
      "program": "${workspaceFolder}/main.py"
    }
  ]
}
```

### 调试功能

- **代码执行**：直接在连接的设备上运行 Python 文件
- **输出捕获**：在调试控制台中实时显示控制台输出
- **错误报告**：详细的错误消息和堆栈跟踪
- **文件传输**：自动将代码上传到设备
- **多文件支持**：处理包含多个 Python 文件的项目

### 开发工作流程

1. **编写代码**：在 VS Code 中创建或编辑 Python 文件
2. **连接设备**：确保设备连接处于活动状态
3. **设置断点**：（当前支持有限）
4. **开始调试**：F5 或在调试面板中点击运行
5. **监控输出**：检查调试控制台的结果
6. **迭代**：进行更改并根据需要重新运行

### 支持的 Python 功能

| 功能 | 支持 | 注意事项 |
|---------|---------|-------|
| 标准库 | ✅ 完整 | 大部分 Python 标准库可用 |
| MaixPy 模块 | ✅ 完整 | 摄像头、显示、AI 等 |
| 文件 I/O | ✅ 部分 | 设备文件系统访问 |
| 网络 | ✅ 完整 | WiFi、HTTP、Socket 支持 |
| 断点 | ⚠️ 有限 | 基本支持，正在改进 |
| 变量检查 | ⚠️ 有限 | 仅控制台输出 |

### 最佳实践

- **小步迭代**：在开发过程中频繁测试代码
- **错误处理**：为设备操作包含 try-catch 块
- **资源管理**：正确关闭摄像头和文件
- **网络超时**：优雅地处理连接失败

## 📚 示例浏览器

### 内置示例

MaixCode 包含从 Sipeed CDN 下载的全面示例库：

#### 示例类别

- **基础示例**：GPIO、传感器、基本设备操作
- **计算机视觉**：摄像头捕获、图像处理、目标检测
- **机器学习**：AI 模型推理、神经网络
- **通信**：WiFi、蓝牙、网络协议
- **显示和 UI**：屏幕输出、用户界面
- **高级项目**：复杂应用程序和演示

### 使用示例

1. **浏览库**：在侧边栏中展开"示例"面板
2. **预览代码**：点击任何示例查看内容预览
3. **打开源码**：右键点击 → "打开源文件"进行编辑
4. **运行示例**：使用调试配置执行
5. **修改和学习**：为您的项目调整示例

### 示例功能

- **实时更新**：示例与最新的 Sipeed 仓库同步
- **代码预览**：内联预览，无需打开文件
- **直接执行**：立即运行示例
- **文件组织**：分层结构便于导航
- **文档**：内联注释和说明

### 管理示例

| 操作 | 方法 | 描述 |
|--------|--------|-------------|
| 刷新 | 点击刷新图标 | 更新示例库 |
| 搜索 | 在示例面板中输入 | 按名称过滤示例 |
| 打开 | 点击示例名称 | 在虚拟文档中预览 |
| 编辑 | 右键点击 → 打开源码 | 复制到工作区进行编辑 |

### 自定义示例

要添加您自己的示例：
1. 在工作区中创建新的 Python 文件
2. 在顶部添加描述性注释
3. 使用 MaixPy 调试配置测试
4. 通过 GitHub 与社区分享！

## ⌨️ 命令参考

### 可用命令

通过命令面板 (Ctrl+Shift+P) 访问所有命令：

| 命令 | 描述 | 快捷键 | 上下文 |
|---------|-------------|----------|---------|
| `MaixCode: Connect Device` | 连接到 MaixCAM 设备 | - | 设备面板 |
| `MaixCode: Disconnect Device` | 断开当前设备连接 | - | 已连接时 |
| `MaixCode: Discover Devices` | 手动扫描设备 | - | 设备面板 |
| `MaixCode: Refresh Devices` | 刷新设备列表 | - | 设备面板 |
| `MaixCode: Open Image Viewer` | 启动实时图像查看器 | - | 已连接时 |
| `MaixCode: Refresh Examples` | 更新示例库 | - | 示例面板 |
| `MaixCode: Open Example` | 打开选定的示例 | - | 示例上下文 |

### 键盘快捷键

目前，MaixCode 使用默认的 VS Code 快捷键。自定义快捷键将在未来版本中提供：

| 操作 | 快捷键 | 描述 |
|--------|----------|-------------|
| 调试 MaixPy | F5 | 开始调试当前文件 |
| 停止调试 | Shift+F5 | 停止当前调试会话 |
| 命令面板 | Ctrl+Shift+P | 访问所有 MaixCode 命令 |
| 切换侧边栏 | Ctrl+B | 显示/隐藏 MaixCode 面板 |

### 上下文菜单操作

右键上下文菜单提供快速访问：

**设备面板**：
- 连接设备
- 查看设备信息
- 复制 IP 地址

**示例面板**：
- 打开源文件
- 复制示例路径
- 运行示例

## ⚙️ 配置

### 扩展设置

通过 VS Code 设置配置 MaixCode（文件 → 首选项 → 设置）：

```json
{
  "maixcode.enableDeviceDiscovery": true,
  "maixcode.discovery.interval": 3000,
  "maixcode.discovery.timeout": 4000,
  "maixcode.imageViewer.defaultRefreshRate": 100,
  "maixcode.debug.autoStart": true
}
```

### 可用设置

| 设置 | 类型 | 默认值 | 描述 |
|---------|------|---------|-------------|
| `maixcode.enableDeviceDiscovery` | boolean | `true` | 启用自动设备发现 |
| `maixcode.discovery.interval` | number | `3000` | 设备扫描间隔（毫秒） |
| `maixcode.discovery.timeout` | number | `4000` | 发现超时（毫秒） |
| `maixcode.imageViewer.defaultRefreshRate` | number | `100` | 默认图像刷新率（毫秒） |
| `maixcode.debug.autoStart` | boolean | `true` | 自动启动调试会话 |

### 工作区配置

添加到您的工作区 `.vscode/settings.json`：

```json
{
  "maixcode.preferredDevice": "192.168.1.100",
  "maixcode.imageViewer.autoOpen": true,
  "maixcode.examples.autoRefresh": true
}
```

## 🛠️ 故障排除

### 常见问题

#### 设备发现问题

**问题**：设备面板中未找到设备
```
解决方案：
✅ 验证设备和 PC 都在同一网络上
✅ 检查设备 WiFi 连接和 IP 地址
✅ 禁用可能阻止发现的 VPN 或代理
✅ 尝试使用设备 IP 手动连接
✅ 重启设备并刷新设备列表
```

**问题**：设备出现但无法连接
```
解决方案：
✅ 检查设备防火墙设置
✅ 验证设备上的 MaixPy 服务正在运行
✅ 尝试不同的网络连接
✅ 检查 IP 地址冲突
✅ 重启 VS Code 并重试
```

#### 图像流传输问题

**问题**：图像查看器显示黑屏
```
解决方案：
✅ 验证摄像头未被其他应用程序使用
✅ 检查设备上的摄像头权限
✅ 尝试切换 HTTP/WebSocket 模式
✅ 降低图像质量设置
✅ 检查网络带宽
```

**问题**：高延迟或视频卡顿
```
解决方案：
✅ 增加刷新间隔（降低频率）
✅ 降低图像质量/分辨率
✅ 从 WebSocket 切换到 HTTP 模式
✅ 检查网络拥塞
✅ 关闭其他占用带宽的应用程序
```

#### 调试和代码执行

**问题**：代码执行失败
```
解决方案：
✅ 验证设备连接处于活动状态
✅ 检查 Python 语法错误
✅ 确保 MaixPy 模块可用
✅ 检查设备存储空间
✅ 查看调试控制台的错误详细信息
```

**问题**：调试控制台无输出
```
解决方案：
✅ 检查代码中的打印语句
✅ 验证调试配置正确
✅ 首先尝试运行简单的测试代码
✅ 直接检查设备控制台输出
✅ 重启调试会话
```

### 调试信息

要帮助诊断问题：

1. **检查扩展日志**：视图 → 输出 → 选择 "MaixCode"
2. **设备网络信息**：在设备上使用命令 `ip addr`
3. **VS Code 开发者工具**：帮助 → 切换开发者工具
4. **扩展版本**：在扩展面板中检查

### 性能优化

为了获得更好的性能：

- **关闭未使用的面板**以减少资源使用
- **限制并发连接**一次只连接一个设备
- **当 WebSocket 不稳定时使用 HTTP 模式**进行图像流传输
- **降低发现频率**如果不经常连接设备
- **定期清理示例缓存**以加快加载速度

### 获得帮助

如果您仍然遇到问题：

1. **检查 GitHub Issues**：[MaixCode Issues](https://github.com/MaixCode/MaixCode/issues)
2. **创建新 Issue**：包括设备信息、VS Code 版本和错误日志
3. **社区论坛**：[Sipeed 论坛](https://bbs.sipeed.com/)
4. **文档**：[DeepWiki](https://deepwiki.com/MaixCode/MaixCode)

## 🤝 贡献

我们欢迎对 MaixCode 的贡献！以下是您可以提供帮助的方式：

### 开发设置

1. **Fork 仓库**：在 [GitHub](https://github.com/MaixCode/MaixCode) 上点击 fork
2. **克隆您的 Fork**：
   ```bash
   git clone https://github.com/your-username/MaixCode.git
   cd MaixCode
   ```
3. **安装依赖**：
   ```bash
   yarn install
   ```
4. **构建扩展**：
   ```bash
   yarn run compile
   ```
5. **开始开发**：按 F5 打开扩展开发主机

### 代码结构

```
src/
├── extension.ts          # 主扩展入口点
├── command.ts           # 命令注册和处理程序
├── constants.ts         # 共享常量和枚举
├── instance.ts          # 单例实例管理
├── logger.ts           # 日志工具
├── Model/              # 数据模型和类型
├── Service/            # 核心服务（发现、设备管理）
├── debugger/           # MaixPy 调试适配器实现
└── ui/                 # 用户界面组件
    ├── provider/       # 树数据提供者
    ├── sidebar.ts      # 侧边栏管理
    └── statusbar.ts    # 状态栏集成
```

### 贡献指南

1. **代码风格**：遵循现有的 TypeScript 约定
2. **测试**：为新功能添加测试
3. **文档**：更新 README 和内联文档
4. **提交**：使用清晰、描述性的提交消息
5. **拉取请求**：包含详细的更改描述

### 贡献领域

- 🐛 **Bug 修复**：检查 [开放问题](https://github.com/MaixCode/MaixCode/issues)
- ✨ **新功能**：设备管理改进、UI 增强
- 📚 **文档**：示例、教程、API 文档
- 🧪 **测试**：单元测试、集成测试、设备兼容性
- 🎨 **UI/UX**：界面改进、可访问性功能

### 构建和测试

```bash
# 编译 TypeScript
yarn run compile

# 在开发过程中监视更改
yarn run watch

# 运行 linting
yarn run lint

# 运行测试
yarn run test

# 打包扩展
yarn run package
```

### 提交更改

1. 创建功能分支：`git checkout -b feature/your-feature`
2. 进行更改并提交：`git commit -m "Add your feature"`
3. 推送到您的 fork：`git push origin feature/your-feature`
4. 创建包含详细描述的拉取请求

## 📜 更新日志

### 版本 0.0.1（当前）

#### 功能
- ✅ 通过 mDNS 自动发现 MaixCAM 设备
- ✅ 实时图像流传输（HTTP/WebSocket）
- ✅ MaixPy 代码执行和调试
- ✅ 与 Sipeed CDN 集成的内置示例库
- ✅ 设备连接管理
- ✅ Visual Studio Code 集成

#### 已知限制
- 断点调试支持有限
- 一次只能连接一个设备
- 网络问题的基本错误处理

#### 即将推出的功能（路线图）
- 🔄 增强调试功能，支持断点和变量检查
- 🔄 多设备支持和设备切换
- 🔄 设备存储的文件系统浏览器
- 🔄 性能分析和监控
- 🔄 自定义示例分享和社区功能
- 🔄 高级图像处理工具集成

## 📄 许可证

本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](LICENSE) 文件。

## 🏷️ 关于 MaixCAM

MaixCAM 是 Sipeed 推出的一系列 AI 驱动的开发板，专为计算机视觉和机器学习应用而设计。这些设备具有：

- **高性能 AI**：专用神经处理单元
- **摄像头集成**：内置各种分辨率的摄像头
- **WiFi 连接**：无线开发和部署
- **MaixPy 运行时**：基于 Python 的开发环境
- **紧凑设计**：便携高效的外形尺寸

### 了解更多

- 🌐 **官方网站**：[Sipeed MaixCAM](https://wiki.sipeed.com/hardware/zh/maixcam/index.html)
- 📖 **文档**：[MaixPy 文档](https://wiki.sipeed.com/soft/maixpy/index.html)
- 💬 **社区论坛**：[Sipeed BBS](https://bbs.sipeed.com/)
- 🛒 **购买**：[Sipeed 商店](https://www.sipeed.com/)

---

<div align="center">
  <p><strong>开始使用 MaixCode 构建令人惊叹的 AI 应用程序！ 🚀</strong></p>
  <p>如有问题、问题或贡献，请访问我们的 <a href="https://github.com/MaixCode/MaixCode">GitHub 仓库</a></p>
</div>