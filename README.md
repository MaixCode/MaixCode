# MaixCode VS Code Extension

[![DeepWiki Badge](https://img.shields.io/badge/More-DeepWiki-blue)](https://deepwiki.com/MaixCode/MaixCode)
[![Version](https://img.shields.io/badge/version-0.0.1-green.svg)](https://github.com/MaixCode/MaixCode)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue.svg)](https://marketplace.visualstudio.com/items?itemName=Cranyozen.maixcode)

> **Languages**: [English](README.md) | [简体中文](README_zh.md)

<div align="center">
  <img src="resources/maixcode.svg" alt="MaixCode Logo" width="128" height="128">
</div>

MaixCode is a powerful Visual Studio Code extension designed for MaixCAM device development. It provides a comprehensive development environment for MaixPy applications, enabling seamless device discovery, real-time debugging, live image streaming, and code execution directly on MaixCAM hardware.

<!-- Screenshots will be added here in future versions -->
<!-- ![Device Discovery](docs/images/device-discovery.png) -->
<!-- ![Image Streaming](docs/images/image-streaming.png) -->
<!-- ![Code Debugging](docs/images/code-debugging.png) -->

## ✨ Key Features

- 🔍 **Auto Device Discovery**: Automatically detect MaixCAM devices on your local network
- 📱 **Real-time Image Streaming**: View live camera feeds from connected devices via HTTP/WebSocket
- 🐛 **Integrated Debugging**: Full debugging support for MaixPy applications
- 📚 **Built-in Examples**: Comprehensive example library to get you started quickly
- ⚡ **One-Click Execution**: Run Python code directly on devices with instant feedback
- 📊 **Device Information**: Monitor device status, system info, and performance metrics
- 🔧 **Visual Interface**: Intuitive sidebar panels for device management and examples

## 🚀 Quick Start

1. **Install the Extension**: Search for "MaixCode" in VS Code Extensions marketplace
2. **Connect Your Device**: Ensure your MaixCAM device is on the same network
3. **Open Device Panel**: Click the MaixCode icon in the activity bar
4. **Start Developing**: Select an example or write your own MaixPy code

## 📋 Table of Contents

- [Installation & Requirements](#-installation--requirements)
- [Getting Started](#-getting-started)
- [Device Management](#-device-management)
- [Image Streaming](#-image-streaming)
- [Code Development & Debugging](#-code-development--debugging)
- [Example Browser](#-example-browser)
- [Command Reference](#-command-reference)
- [Configuration](#-configuration)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [About MaixCAM](#-about-maixcam)

## 📦 Installation & Requirements

### Prerequisites

- **VS Code**: Version 1.92.0 or higher
- **Node.js**: Version 16 or higher (for development)
- **MaixCAM Device**: Connected to the same local network
- **Network Access**: Ensure proper network connectivity between PC and device

### Installation Methods

#### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "MaixCode"
4. Click "Install" on the extension by Cranyozen

#### From VSIX File
1. Download the latest `.vsix` file from [Releases](https://github.com/MaixCode/MaixCode/releases)
2. Open VS Code Command Palette (Ctrl+Shift+P)
3. Run "Extensions: Install from VSIX..."
4. Select the downloaded file

#### Development Installation
```bash
git clone https://github.com/MaixCode/MaixCode.git
cd MaixCode
yarn install
yarn run compile
# Press F5 to open a new VS Code window with the extension loaded
```

### Verification
After installation, you should see the MaixCode icon (🔧) in the VS Code activity bar.

## 🎯 Getting Started

### First-Time Setup

1. **Activate Extension**: Open VS Code and click the MaixCode icon in the activity bar
2. **Check Device Panel**: The "Device" panel will automatically start discovering MaixCAM devices
3. **Verify Network**: Ensure your MaixCAM device and PC are on the same network
4. **Connect Device**: Click the connect button (🔗) next to any discovered device

### Your First MaixPy Program

1. **Browse Examples**: Expand the "Example" panel to see available code samples
2. **Open Example**: Click on any example to preview, or right-click → "Open Source File"
3. **Run Code**: Use the debug panel with "MaixPy Debug" configuration
4. **View Output**: Check the Debug Console for execution results

## 🔌 Device Management

### Automatic Discovery

The extension automatically scans your local network for MaixCAM devices using mDNS. Discovered devices appear in the "Device" panel with their:
- IP Address
- Device Name
- Connection Status
- Last Seen Time

### Manual Connection

If automatic discovery doesn't work:
1. Open Command Palette (Ctrl+Shift+P)
2. Run "MaixCode: Connect Device"
3. Enter the device IP address manually
4. Click "Connect"

### Device Operations

| Action | Description | How to Access |
|--------|-------------|---------------|
| Connect | Establish connection to device | Click 🔗 next to device IP |
| Disconnect | Close active connection | Command Palette → "MaixCode: Disconnect Device" |
| Refresh | Rescan for devices | Click refresh button in Device panel |
| Info | View device system information | Available after connection |

### Connection Status

- 🟢 **Connected**: Device is active and ready
- 🟡 **Connecting**: Connection in progress
- 🔴 **Disconnected**: No active connection
- ⚫ **Not Found**: Device not reachable

## 📹 Image Streaming

### Live Camera Feed

MaixCode provides real-time image streaming from your MaixCAM device's camera:

1. **Open Image Viewer**: 
   - Command Palette (Ctrl+Shift+P) → "MaixCode: Open Image Viewer"
   - Or click the camera icon in the device panel

2. **Select Device**: Choose your connected device from the dropdown

3. **Choose Stream Mode**:
   - **HTTP Mode**: Standard HTTP requests (more stable)
   - **WebSocket Mode**: Real-time streaming (lower latency)

### Image Viewer Features

- **Real-time Preview**: Live camera feed with configurable refresh rate
- **Screenshot Capture**: Save current frame as image file
- **Stream Controls**: Start/stop streaming with visual feedback
- **Performance Metrics**: View FPS, latency, and connection status
- **Quality Settings**: Adjust image quality and compression
- **Full-screen Mode**: Expand viewer for better visibility

### Streaming Configuration

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| Refresh Interval | Update frequency in milliseconds | 100ms | 50-1000ms |
| Image Quality | JPEG compression level | 85% | 50-100% |
| Resolution | Image dimensions | Device default | Device dependent |

### Troubleshooting Streaming

- **No Image**: Check device camera permissions and connection
- **High Latency**: Try reducing refresh interval or image quality
- **Connection Drops**: Switch from WebSocket to HTTP mode
- **Poor Quality**: Increase JPEG quality or check network bandwidth

## 🐛 Code Development & Debugging

### MaixPy Debug Configuration

MaixCode includes a specialized debugger for MaixPy applications:

#### Launch Configuration

Add this to your `.vscode/launch.json`:

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

### Debugging Features

- **Code Execution**: Run Python files directly on connected devices
- **Output Capture**: Real-time console output in Debug Console
- **Error Reporting**: Detailed error messages and stack traces
- **File Transfer**: Automatic code upload to device
- **Multi-file Support**: Handle projects with multiple Python files

### Development Workflow

1. **Write Code**: Create or edit Python files in VS Code
2. **Connect Device**: Ensure device connection is active
3. **Set Breakpoints**: (Currently limited support)
4. **Start Debugging**: F5 or click Run in Debug panel
5. **Monitor Output**: Check Debug Console for results
6. **Iterate**: Make changes and re-run as needed

### Supported Python Features

| Feature | Support | Notes |
|---------|---------|-------|
| Standard Library | ✅ Full | Most Python stdlib available |
| MaixPy Modules | ✅ Full | Camera, Display, AI, etc. |
| File I/O | ✅ Partial | Device file system access |
| Networking | ✅ Full | WiFi, HTTP, Socket support |
| Breakpoints | ⚠️ Limited | Basic support, improvements coming |
| Variable Inspection | ⚠️ Limited | Console output only |

### Best Practices

- **Small Iterations**: Test code frequently during development
- **Error Handling**: Include try-catch blocks for device operations
- **Resource Management**: Properly close cameras and files
- **Network Timeouts**: Handle connection failures gracefully

## 📚 Example Browser

### Built-in Examples

MaixCode includes a comprehensive library of examples downloaded from Sipeed's CDN:

#### Example Categories

- **Basic Examples**: GPIO, sensors, basic device operations
- **Computer Vision**: Camera capture, image processing, object detection
- **Machine Learning**: AI model inference, neural networks
- **Communication**: WiFi, Bluetooth, network protocols
- **Display & UI**: Screen output, user interfaces
- **Advanced Projects**: Complex applications and demos

### Using Examples

1. **Browse Library**: Expand "Example" panel in sidebar
2. **Preview Code**: Click any example to see content preview
3. **Open Source**: Right-click → "Open Source File" for editing
4. **Run Example**: Use debug configuration to execute
5. **Modify & Learn**: Adapt examples for your projects

### Example Features

- **Live Updates**: Examples sync with latest Sipeed repository
- **Code Preview**: In-line preview without opening files
- **Direct Execution**: Run examples immediately
- **File Organization**: Hierarchical structure for easy navigation
- **Documentation**: Inline comments and explanations

### Managing Examples

| Action | How To | Description |
|--------|--------|-------------|
| Refresh | Click refresh icon | Update example library |
| Search | Type in example panel | Filter examples by name |
| Open | Click example name | Preview in virtual document |
| Edit | Right-click → Open Source | Copy to workspace for editing |

### Custom Examples

To add your own examples:
1. Create a new Python file in your workspace
2. Add descriptive comments at the top
3. Test with MaixPy Debug configuration
4. Share with the community via GitHub!

## ⌨️ Command Reference

### Available Commands

Access all commands via Command Palette (Ctrl+Shift+P):

| Command | Description | Shortcut | Context |
|---------|-------------|----------|---------|
| `MaixCode: Connect Device` | Connect to a MaixCAM device | - | Device panel |
| `MaixCode: Disconnect Device` | Disconnect current device | - | When connected |
| `MaixCode: Discover Devices` | Manually scan for devices | - | Device panel |
| `MaixCode: Refresh Devices` | Refresh device list | - | Device panel |
| `MaixCode: Open Image Viewer` | Launch real-time image viewer | - | When connected |
| `MaixCode: Refresh Examples` | Update example library | - | Example panel |
| `MaixCode: Open Example` | Open selected example | - | Example context |

### Keyboard Shortcuts

Currently, MaixCode uses default VS Code shortcuts. Custom shortcuts coming in future versions:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Debug MaixPy | F5 | Start debugging current file |
| Stop Debug | Shift+F5 | Stop current debug session |
| Command Palette | Ctrl+Shift+P | Access all MaixCode commands |
| Toggle Sidebar | Ctrl+B | Show/hide MaixCode panels |

### Context Menu Actions

Right-click context menus provide quick access:

**Device Panel**:
- Connect Device
- View Device Info
- Copy IP Address

**Example Panel**:
- Open Source File
- Copy Example Path
- Run Example

## ⚙️ Configuration

### Extension Settings

Configure MaixCode through VS Code settings (File → Preferences → Settings):

```json
{
  "maixcode.enableDeviceDiscovery": true,
  "maixcode.discovery.interval": 3000,
  "maixcode.discovery.timeout": 4000,
  "maixcode.imageViewer.defaultRefreshRate": 100,
  "maixcode.debug.autoStart": true
}
```

### Available Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `maixcode.enableDeviceDiscovery` | boolean | `true` | Enable automatic device discovery |
| `maixcode.discovery.interval` | number | `3000` | Device scan interval (ms) |
| `maixcode.discovery.timeout` | number | `4000` | Discovery timeout (ms) |
| `maixcode.imageViewer.defaultRefreshRate` | number | `100` | Default image refresh rate (ms) |
| `maixcode.debug.autoStart` | boolean | `true` | Auto-start debug sessions |

### Workspace Configuration

Add to your workspace `.vscode/settings.json`:

```json
{
  "maixcode.preferredDevice": "192.168.1.100",
  "maixcode.imageViewer.autoOpen": true,
  "maixcode.examples.autoRefresh": true
}
```

## 🛠️ Troubleshooting

### Common Issues

#### Device Discovery Problems

**Problem**: No devices found in Device panel
```
Solutions:
✅ Verify both device and PC are on same network
✅ Check device WiFi connection and IP address
✅ Disable VPN or proxy that might block discovery
✅ Try manual connection with device IP
✅ Restart device and refresh device list
```

**Problem**: Device appears but cannot connect
```
Solutions:
✅ Check device firewall settings
✅ Verify MaixPy service is running on device
✅ Try different network connection
✅ Check for IP address conflicts
✅ Restart VS Code and try again
```

#### Image Streaming Issues

**Problem**: Image viewer shows black screen
```
Solutions:
✅ Verify camera is not in use by other apps
✅ Check camera permissions on device
✅ Try switching HTTP/WebSocket modes
✅ Reduce image quality settings
✅ Check network bandwidth
```

**Problem**: High latency or stuttering video
```
Solutions:
✅ Increase refresh interval (lower frequency)
✅ Reduce image quality/resolution
✅ Switch to HTTP mode from WebSocket
✅ Check network congestion
✅ Close other bandwidth-heavy applications
```

#### Debug and Code Execution

**Problem**: Code execution fails
```
Solutions:
✅ Verify device connection is active
✅ Check Python syntax errors
✅ Ensure MaixPy modules are available
✅ Check device storage space
✅ Review Debug Console for error details
```

**Problem**: No output in Debug Console
```
Solutions:
✅ Check print statements in your code
✅ Verify debug configuration is correct
✅ Try running simple test code first
✅ Check device console output directly
✅ Restart debug session
```

### Debug Information

To help diagnose issues:

1. **Check Extension Logs**: View → Output → Select "MaixCode"
2. **Device Network Info**: Use command `ip addr` on device
3. **VS Code Developer Tools**: Help → Toggle Developer Tools
4. **Extension Version**: Check in Extensions panel

### Performance Optimization

For better performance:

- **Close unused panels** to reduce resource usage
- **Limit concurrent connections** to one device at a time
- **Use HTTP mode** for image streaming when WebSocket is unstable
- **Reduce discovery frequency** if not actively connecting devices
- **Clear example cache** periodically for faster loading

### Getting Help

If you're still experiencing issues:

1. **Check GitHub Issues**: [MaixCode Issues](https://github.com/MaixCode/MaixCode/issues)
2. **Create New Issue**: Include device info, VS Code version, and error logs
3. **Community Forums**: [Sipeed Forum](https://bbs.sipeed.com/)
4. **Documentation**: [DeepWiki](https://deepwiki.com/MaixCode/MaixCode)

## 🤝 Contributing

We welcome contributions to MaixCode! Here's how you can help:

### Development Setup

1. **Fork the Repository**: Click fork on [GitHub](https://github.com/MaixCode/MaixCode)
2. **Clone Your Fork**:
   ```bash
   git clone https://github.com/your-username/MaixCode.git
   cd MaixCode
   ```
3. **Install Dependencies**:
   ```bash
   yarn install
   ```
4. **Build Extension**:
   ```bash
   yarn run compile
   ```
5. **Start Development**: Press F5 to open Extension Development Host

### Code Structure

```
src/
├── extension.ts          # Main extension entry point
├── command.ts           # Command registration and handlers
├── constants.ts         # Shared constants and enums
├── instance.ts          # Singleton instance management
├── logger.ts           # Logging utilities
├── Model/              # Data models and types
├── Service/            # Core services (discovery, device management)
├── debugger/           # MaixPy debug adapter implementation
└── ui/                 # User interface components
    ├── provider/       # Tree data providers
    ├── sidebar.ts      # Sidebar management
    └── statusbar.ts    # Status bar integration
```

### Contributing Guidelines

1. **Code Style**: Follow existing TypeScript conventions
2. **Testing**: Add tests for new features
3. **Documentation**: Update README and inline docs
4. **Commits**: Use clear, descriptive commit messages
5. **Pull Requests**: Include detailed description of changes

### Areas for Contribution

- 🐛 **Bug Fixes**: Check [open issues](https://github.com/MaixCode/MaixCode/issues)
- ✨ **New Features**: Device management improvements, UI enhancements
- 📚 **Documentation**: Examples, tutorials, API documentation
- 🧪 **Testing**: Unit tests, integration tests, device compatibility
- 🎨 **UI/UX**: Interface improvements, accessibility features

### Building and Testing

```bash
# Compile TypeScript
yarn run compile

# Watch for changes during development  
yarn run watch

# Run linting
yarn run lint

# Run tests
yarn run test

# Package extension
yarn run package
```

### Submitting Changes

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes and commit: `git commit -m "Add your feature"`
3. Push to your fork: `git push origin feature/your-feature`
4. Create a Pull Request with detailed description

## 📜 Changelog

### Version 0.0.1 (Current)

#### Features
- ✅ Automatic MaixCAM device discovery via mDNS
- ✅ Real-time image streaming (HTTP/WebSocket)
- ✅ MaixPy code execution and debugging
- ✅ Built-in example library with Sipeed CDN integration
- ✅ Device connection management
- ✅ Visual Studio Code integration

#### Known Limitations
- Limited breakpoint debugging support
- Single device connection at a time
- Basic error handling for network issues

#### Upcoming Features (Roadmap)
- 🔄 Enhanced debugging with breakpoints and variable inspection
- 🔄 Multi-device support and device switching
- 🔄 File system browser for device storage
- 🔄 Performance profiling and monitoring
- 🔄 Custom example sharing and community features
- 🔄 Advanced image processing tools integration

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏷️ About MaixCAM

MaixCAM is a series of AI-powered development boards created by Sipeed, designed for computer vision and machine learning applications. These devices feature:

- **High-Performance AI**: Dedicated neural processing units
- **Camera Integration**: Built-in cameras with various resolutions
- **WiFi Connectivity**: Wireless development and deployment
- **MaixPy Runtime**: Python-based development environment
- **Compact Design**: Portable and efficient form factor

### Learn More

- 🌐 **Official Website**: [Sipeed MaixCAM](https://wiki.sipeed.com/hardware/zh/maixcam/index.html)
- 📖 **Documentation**: [MaixPy Docs](https://wiki.sipeed.com/soft/maixpy/index.html)
- 💬 **Community Forum**: [Sipeed BBS](https://bbs.sipeed.com/)
- 🛒 **Purchase**: [Sipeed Store](https://www.sipeed.com/)

---

<div align="center">
  <p><strong>Start building amazing AI applications with MaixCode! 🚀</strong></p>
  <p>For questions, issues, or contributions, visit our <a href="https://github.com/MaixCode/MaixCode">GitHub repository</a></p>
</div>
