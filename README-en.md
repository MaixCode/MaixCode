# MaixCode — VS Code Extension for MaixCAM

[![DeepWiki Badge](https://img.shields.io/badge/More-DeepWiki-blue)](https://deepwiki.com/MaixCode/MaixCode)

[中文](README.md) | [English]

MaixCode is a VS Code extension for MaixCAM / MaixPy development, providing device discovery, connection, code execution & debugging, real-time image preview, SSH terminal, SFTP file management, and more — all inside your editor.

---

## Features

- **Device Discovery & Connection** — mDNS auto-scan for MaixCAM devices on LAN; manual and auto-connect
- **Code Run & Debug** — One-click Python execution with `maixpy` debug adapter; file & project modes
- **Real-time Image Preview** — HTTP / WebSocket / MJPEG transports with zoom, pan, and screenshot
- **Color Histogram** — Live RGB / GRAY / LAB / YUV / HSV per-channel charts with hover tooltips
- **SSH Terminal** — Built-in SSH terminal via `@cweijan/ssh2`; multi-session support
- **SFTP File Management** — Virtual filesystem (`maixsftp://`) mounted into VS Code Explorer
- **Project Packaging** — `app.yaml` config → zip package → install to device → run
- **Runtime Installer** — Fetch and flash MaixVision runtime from Sipeed cloud
- **Multi-source Examples** — Official CDN (sipeed), local folders, and GitHub repos

---

## Requirements

- VS Code **1.92.0** or later
- MaixCAM device on the same LAN
- SSH enabled on device (default port 22)

---

## Quick Start

### Connect to a Device

1. Click the **MaixCode** icon (`$(circuit-board)`) in the Activity Bar
2. Devices are auto-discovered on the LAN (hostnames prefixed `maixcam`); manual IP input also supported
3. Status indicator: <span style="color:gray">⚫</span> offline / <span style="color:green">🟢</span> online / <span style="color:orange">🟠</span> connected

### Run Code

- **Run Current File**: Open a `.py` editor → click ▶ in title bar or `MaixCode: Run Current File on Device`
- **Run Project**: `MaixCode: Run Project on Device` (auto packages → deploys → runs)
- F5 Debug panel provides **MaixPy Debug** configs for file and project modes

### Image Preview

1. Device sidebar **Current Device Info** → **Open Image Viewer**, or Secondary Sidebar → **MaixCode** → **Image**, or `MaixCode: Open Image Viewer`
2. Select a connected device, click **Start** (auto-starts by default)
3. Toolbar: switch HTTP / WS / MJPEG, start/stop, screenshot
4. Enable **Hist** for color histogram; switch color space via dropdown
5. **Scroll to zoom**, **drag to pan**, **double-click to reset**

### SSH Terminal

- Click the terminal icon next to device IP, or `MaixCode: Open SSH Terminal`
- Credentials via `maixcode.sshCredentials`, tried in order (default `root` / `root` or `root` / `sipeed`)

### SFTP File Management

- Click folder icon or `MaixCode: Open Device Files (SFTP)`
- Device files mount as `maixsftp://` workspace folder
- Full CRUD support (optional read-only mode)
- Right-click → Filter/Unfilter entries; glob & regex patterns supported

### Project Packaging

1. Right-click a folder or `MaixCode: Configure Project (app.yaml)` to create config
2. `app.yaml` specifies id, name, version, entry file, etc.
3. **Package App** → `dist/maix-{id}-v{version}.zip`
4. **Install App** or **Package and Install App** → deploys to device

### Browse Examples

- **Example** panel with multi-source trees (`maixcode.exampleSources`)
- Click file → `example://` virtual editor (safe editing, Save As to persist)
- Right-click → **Open Source File** for real cached file (may be overwritten on refresh)
- Source types: `sipeed` (official CDN), `local_folder`, `github_repo`

---

## Debug Configuration

`launch.json`:

```json
{
  "type": "maixpy",
  "request": "launch",
  "name": "MaixPy: Run Current File",
  "program": "${file}"
}
```

Project mode:

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

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `maixcode.enableDeviceDiscovery` | `true` | Enable mDNS device discovery |
| `maixcode.autoConnect` | `true` | Auto-connect when a device is discovered |
| `maixcode.autoConnectTarget` | `""` | Preferred device hostname or IP |
| `maixcode.imageServicePort` | `9090` | Local image service port (0=ephemeral) |
| `maixcode.imageViewerDefaultMode` | `"websocket"` | Default image transport |
| `maixcode.imageHttpIntervalMs` | `33` | HTTP poll interval (ms) |
| `maixcode.imageViewerAutoStart` | `true` | Auto-start stream when preview opens with a device |
| `maixcode.autoOpenImageViewer` | `true` | Auto-open Image sidebar on connect |
| `maixcode.sshPort` | `22` | SSH port |
| `maixcode.sshConnectTimeoutMs` | `10000` | SSH connect timeout |
| `maixcode.sshCredentials` | `root`/`root`, `root`/`sipeed` | SSH credentials list (tried in order) |
| `maixcode.autoOpenSftp` | `true` | Auto-open SFTP on connect |
| `maixcode.sftpReadOnly` | `false` | SFTP read-only mode |
| `maixcode.sftpHidePatterns` | — | Hide matching SFTP entries |
| `maixcode.sftpShowFiltered` | `false` | Show filtered entries with H badge |
| `maixcode.sftpBookmarks` | Root, Home | SFTP bookmark folders |
| `maixcode.exampleSources` | Official | Example source config |
| `maixcode.githubToken` | `""` | GitHub token for private repos |

---

## Development

```bash
yarn install          # install dependencies
yarn run compile      # webpack → dist/extension.js
yarn run watch        # webpack watch (F5 debug)
yarn run lint         # ESLint
yarn run test         # run tests
yarn run package:vsix # build VSIX
```

F5 launches the Extension Development Host. See [AGENTS.md](AGENTS.md) for architecture details.

---

## About MaixCAM

MaixCAM is an AIoT development board series by Sipeed, designed for computer vision and machine learning applications. More information at [Sipeed Wiki](https://wiki.sipeed.com/hardware/zh/maixcam/index.html).

**Enjoy coding with MaixCode!**
