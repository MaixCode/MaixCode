# AGENTS.md

VS Code extension for MaixCAM / MaixPy (discover devices, connect, run/debug code, live image, multi-source examples).

## Package manager

- Use **Yarn classic** (`yarn.lock` v1). Prefer `yarn` / `yarn run <script>` (scripts already use `yarn run` in `pretest` / `vscode:prepublish`).
- Native deps: `@cweijan/ssh2`, optional `cpu-features` may compile on install; first install can take longer. Pure JS deps are webpack-bundled into `dist/extension.js` and not shipped under `node_modules` in the VSIX.

```bash
yarn install
yarn run compile          # webpack -> dist/extension.js
yarn run watch            # default F5 preLaunch task
yarn run package          # production webpack (vscode:prepublish)
yarn run lint             # eslint src --ext ts
yarn run compile-tests    # tsc -> out/ (tests only; extension itself is webpack)
yarn run test             # pretest = compile-tests + compile + lint, then vscode-test
```

## CI (GitHub Actions)

- Workflow: `.github/workflows/build-vsix.yml` (`Build VSIX`).
- Triggers: `push` / `pull_request` to `main` or `master`, plus `workflow_dispatch`.
- Runner: Node **22** + Yarn classic (`actions/setup-node` `cache: yarn` from `yarn.lock`).
- Steps: `yarn install --frozen-lockfile` → `yarn run lint` → `yarn run package:vsix` (`vsce package --yarn --dependencies --packagedDependencies @cweijan/ssh2`; `vscode:prepublish` runs production webpack first).
- Artifact: uploads `*.vsix` as **`maixcode-vsix`** (retention 30 days). Download from the Actions run summary.
- Local equivalent: `yarn run package:vsix` → `maixcode-<version>.vsix` (gitignored).
- Package size: pure JS deps are webpack-bundled; vsce ships only `@cweijan/ssh2` production tree (`--packagedDependencies @cweijan/ssh2`) plus ignore junk (tests/docs/`nan`/`buildcheck`). No `sharp`/libvips.


## Layout

| Path | Role |
|------|------|
| `src/extension.ts` | `activate` / `deactivate` entry |
| `src/instance.ts` | composition root: wires services + UI (singleton) |
| `src/constants.ts` | command IDs + debug type (`maixpy`) — keep in sync with `package.json` `contributes` |
| `src/command.ts` | command registration |
| `src/service/` | discovery, device manager, websocket, image HTTP, run session, example sources |
| `src/service/project_package_service.ts` / `project_deploy_service.ts` | app.yaml package, InstallApp, RunProject |
| `src/service/runtime_service.ts` | Install/update MaixVision runtime (Sipeed API + UpdateRuntime) |
| `src/service/example_source/` | pluggable example backends (`sipeed`, `local_folder`, `github_repo`) |
| `src/model/` | device/status/image types (lowercase dirs; do not reintroduce `Model`/`Service`) |
| `src/ui/` | sidebar, status bar, tree providers, image viewer webview |
| `src/ui/provider/example.ts` | Example tree + open virtual/source file |
| `src/ui/provider/example_fs.ts` | virtual FS (`example://`) + disk rehydrate |
| `src/ui/provider/app_config_editor.ts` + `media/app_config_editor/*` | visual `app.yaml` WebviewPanel editor |
| `src/debugger/` | inline Debug Adapter (not a separate Python process) |
| `package.nls.json` / `package.nls.zh-cn.json` | Static contributes i18n (`%key%` in `package.json`) |
| `l10n/bundle.l10n*.json` | Runtime `vscode.l10n.t` bundles (`l10n` field in package.json) |
| `dist/` | webpack output; `package.json` `main` |
| `out/` | tsc test output only (gitignored) |

Webpack: single Node target bundle `src/extension.ts` → `dist/extension.js`; `vscode` is external. Source maps: dev `nosources-source-map`, package `hidden-source-map`.

## Architecture (agents)

- **Composition root**: `Instance` constructs and owns services/UI. Services must **not** call `Instance` or UI modules for business flow; inject callbacks/ports instead.
- **Run path**: `RunSession` coordinates device run/stop; debug adapter uses it (or equivalent) rather than UI reaching into WS directly for stop/busy.
- **Ports** (where present): thin interfaces such as transport / frame sink keep device I/O out of UI and debugger glue.
- Prefer the **smallest correct change**; keep command IDs, menus, and `contextValue`s aligned across `package.json` and TS.

## Runtime / product facts agents miss

- **Activation**: `"activationEvents": ["*"]` — loads early; discovery starts in `activate`.
- **Discovery**: mDNS over each non-internal IPv4 NIC; PTR `_ssh._tcp.local` with name prefix `maixcam`, then A records. Loop ~3s; stale drop ~4s.
- **Device control**: WebSocket `ws://<ip>:7899`, binary framing (magic + version + command IDs in `websocket_service.ts`). Auth string `"maixvision"`.
- **Project package / deploy**: `ProjectPackageService` + `ProjectDeployService` (`src/service/project_*`). `app.yaml` (id/name/version/author/desc/icon/files). Commands: `maixcode.configureProject` (opens visual `AppConfigEditor` WebviewPanel; writes `app.yaml`), `packageApp`, `installApp`, `packageAndInstallApp`, `runProject`. Blocking QuickInput `configureInteractive` still used when package/install needs config mid-flow. Package progress toast dismisses before result dialogs (dialogs not inside `withProgress`). Package → `dist/maix-{id}-v{version}.zip` (single file → zip `main.py`; multi keeps paths; always include `app.yaml`+icon). Install → WS `InstallApp(16)` zip bytes; progress via `InstallAppAck` / `installApp` events. **Run Project** → packages folder then `vscode.debug.startDebugging` with `type: maixpy`, `mode: "project"`, `projectDir`, optional `projectZip`; adapter uses `MaixPyRuntime.startProject` / `RunSession.startProject` / WS `RunProject(18)`. Requires `main.py`; size warn >5MB block >30MB. UI: Device sidebar action rows + view title icons; Explorer folder context.
- **App config editor** (`ui/provider/app_config_editor.ts` + `media/app_config_editor/*`): editor `WebviewPanel` (`viewType` `maixcodeAppConfig`) for `app.yaml` (id/name/version/author/desc/icon/files). Command `maixcode.configureProject` → `AppConfigEditor.show(hint)`. Host loads/saves via `ProjectPackageService`; file checklist from `listProjectFiles`; icon browse (copy external → `app.png`); watches `app.yaml`/`app.yml` for external edits (reload form); form changes debounce auto-save; icons copied to `app.png` (no native resize); Ctrl/Cmd+S forces save + toast. No `Instance` import; inject `packageService`.
- **Install Runtime**: `RuntimeService` (`src/service/runtime_service.ts`). Command `maixcode.installRuntime`. Flow (MaixVision-compatible): DeviceInfo JSON includes `device`, `runtime`, `apiKey`, `sysVer`, `maixpyVer` → GET `https://maixvision.sipeed.com/api/v1/devices/encryption/version` (headers `token: MaixVision2024`, params `uid=apiKey`, `os`, `maixpy`) → if newer (or reinstall) GET `/v1/devices/encryption` (`uid`, `device` mapped via `MaixCAM2→maixcam2`, `MaixCAM/MaixCAM-Pro→maixcam`, `version`) as `application/octet-stream` → payload `version + NUL + firmware` via WS `UpdateRuntime(19)`; progress `UpdateRuntimeAck(20)` (`content[0]`=progress, `content[1]===0` success); at 100% re-query `DeviceInfo`. UI: Device tree action **Install Runtime** + view title icon; shows Device/Runtime lines under Current Device Info.
- **SSH terminal**: `SshTerminalService` (`src/service/ssh/`) uses `@cweijan/ssh2` + VS Code `Pseudoterminal` (no system `ssh`). Command `maixcode.openDeviceTerminal`. Credentials: `maixcode.sshCredentials` (array, tried in order; auth fail → next; network fail → stop). Port/timeout: `maixcode.sshPort`, `maixcode.sshConnectTimeoutMs`. Multi-session: each open creates a new terminal. UI: Device tree Open SSH Terminal under Current Device Info + inline on `maixcode-deviceIp`. Host key verifier accepts all (dev convenience). Webpack externals: `@cweijan/ssh2`, `cpu-features`. Native modules may rebuild on install.
- **SFTP virtual FS**: `SftpService` + `SftpFileSystemProvider` (`maixsftp://`). Separate SSH connection from shell (`SftpSession`). Command `maixcode.openDeviceSftp` adds a workspace folder (`MaixSFTP: <name>`) and reveals it in Explorer. URI: `maixsftp://<authority>/<remote/abs/path>` (authority = sanitized device name or IP). Config: `maixcode.sftpBookmarks` (first-level folders: name/remotePath/order; default Root `/` + Home `/root`), legacy `sftpRoot`, `maixcode.sftpReadOnly`, `maixcode.sftpHidePatterns` (glob or `/regex/`; `readDirectory`), `maixcode.sftpShowFiltered` (show filtered with `H` badge via `SftpFileDecorationProvider`). Explorer context on `resourceScheme == maixsftp`: Refresh (`maixcode.sftpRefresh`), Filter / Unfilter / Toggle Show Filtered / Edit Patterns. Filter adds full remote path to settings (Global). Shared credentials: `credentials.ts`. UI: Device Info + inline `deviceIp`. Auto-open: `autoOpenSftp` on connection list change (quiet, dedupe). Reload restore: persist mounts in `globalState` (`SftpMountsStateKey`); `ensureMount` lazy-remounts when Explorer hits `maixsftp://` with empty memory. Provider: full FS ops; symlink-aware (`lstat`/`readlink`/`statPreferFollow`, dir listing via `realpath` for link dirs like `/sbin`); watch no-op.
- **Images**: device frames → `FrameStore` (`frame_store.ts`) via `FrameSink.setImage`; key = device **name** (fallback ip), same as `DeviceService` `onFrame`.
- **ImageService** (`image_service.ts`): local HTTP on `127.0.0.1` (port `maixcode.imageServicePort`, default 9090, fallback ephemeral). Shared store + three transports:
  - HTTP pull: `GET/HEAD /image/:key` (ETag/304, `X-Frame-*` / `X-Image-*` headers; CORS expose)
  - WebSocket: JSON control `subscribe`/`pull`/`ping` + binary frame after `op:frame` meta; push per subscribed key; legacy plain-key message = subscribe pull once. Push skips if `bufferedAmount` high (FrameStore keeps latest).
  - MJPEG: `GET /stream/:key` multipart; wait for first frame; backpressure skip (`writableNeedDrain` / socket buffer)
  - Also `GET /keys`, `GET /`. No product HTML under `/view`.
- **ImageViewer** (`ui/provider/image_viewer.ts` + `media/image_viewer/*`): no `Instance` import; deps inject listConnected + imageService. Surfaces: secondary-sidebar `WebviewView` id `maixcode-image` (container `maixcode-secondary`) + optional editor `WebviewPanel`. Commands: `maixcode.openImageViewer` / `openImageViewerSidebar` focus sidebar view; `maixcode.openImageViewerPanel` opens editor panel (editor/title on `activeWebviewPanelId == maixcodeImagePreview` shows sidebar action). UI: Device tree action **Open Image Viewer** under Current Device Info + Devices view title icon; focuses secondary-sidebar Image view. Modes HTTP / WebSocket / MJPEG. Config: `imageViewerDefaultMode`, `imageHttpIntervalMs`, `imageViewerAutoStart` (default true: open webview → enable Hist dock + auto Start when a device is available; also starts when device list later gains a connection), `autoOpenImageViewer` (default true: focus secondary-sidebar Image view on device connect via `ImageViewer.tryAutoOpenSidebar`; once per connected stretch). Screenshot via Save dialog (canvas dataUrl or store buffer). Client paint is latest-only (one decode + one pending blob). Optional color histogram dock below image (toolbar Hist, default on): RGB / GRAY / LAB / YUV / HSV; one chart per channel with axes; hover tooltips (bin/count/%/CDF/mean); dock height drag-resizable (max ~80%, equal chart cells, no scrollbar); client-side from displayed frame; in-webview Settings: hist quality Fast160/Balanced320/High640/Full + interval; persisted via webview state. Stage pan/zoom: wheel zoom (cursor-anchored), drag pan, double-click reset; pan clamped so image cannot fully leave stage; zoom badge + HUD %.
- **Debug type** `maixpy`: registered as **inline** `DebugAdapterDescriptorFactory` in `debugger/debugger.ts`. Do **not** reintroduce stale `contributes.debuggers.program` / `"runtime": "python"` — the adapter is TypeScript, not an external Python program.
- **F5 / debug configs**: `DebugConfigurationProvider` (Initial + Dynamic + default) in `extension.ts` provides **Run Current File** and **Run Project**; empty config (F5 without launch.json) shows QuickPick. Launch fields: `mode: file|project`, `projectDir`, optional `projectZip`. Status bar: device status + **Run File** (`maixcode.runOnDevice`) + **Run Project** (`maixcode.runProject`) items (`ui/statusbar.ts`).
- **Run / debug source resolve**: `debugger/source_resolve.ts` maps active editor (including `example://` and untitled) to content/path for launch. Prefer this over assuming `document.uri.fsPath` always works.
- **Stop / busy**: stop should end the debug session (`TerminatedEvent` path). Re-run while code is already running should stop-then-retry rather than silently fail.
- **Commands**: IDs in `Commands` namespace; tree `contextValue`s gate menus (`maixcode-deviceIp`, `exampleSource`, `file`, …).
- **Config**: `maixcode.enableDeviceDiscovery`, `maixcode.autoConnect` (default true), `maixcode.autoConnectTarget` (hostname/IP or empty → last-connected then first), `maixcode.autoOpenSftp` (default true; quiet SFTP mount on device connect via `SftpService.tryAutoOpenFromConnected`), `maixcode.autoOpenImageViewer` (default true; focus Image view on connect via `ImageViewer.tryAutoOpenSidebar`). Discovery honors the discovery setting; auto-connect from `onDeviceChanged`.
- **Logging**: output channel via `logger.ts` (`initLogger` in activate). `debug()` always `console.log`s; never interpolate raw image/binary `Uint8Array` into debug strings (see `websocket_service` receive path — used to stringify every Img frame and grow host latency over time).

## Examples

### Sources (`maixcode.exampleSources`)

- First tree level = one folder per source (`id` / `label`).
- Types:
  - `sipeed` — CDN zip (default base related to `https://cdn.sipeed.com/maixvision/examples`), cached under globalStorage.
  - `local_folder` — user directory; `path` may be absolute, `~/...`, `${workspaceFolder}/...`, or `file://...`. Resolve via `resolveUserPath` in `example_source/types.ts` (Node does **not** expand `~` by itself).
  - `github_repo` — `owner` / `repo` / `ref` / optional `subdir`; optional `maixcode.githubToken` for private repos.
- Legacy config type name `localfile` is normalized to `local_folder` in the registry.
- Cache layout: `globalStorage/cache/sources/<id>/...` (`sourcesRoot`).
- **Refresh all**: command `maixcode.refreshExample` (view title on Example).
- **Refresh one source**: `maixcode.refreshExampleSource` when `viewItem == exampleSource` (inline).

### Virtual editor (`example://`)

- Scheme `example`, authority `examples`, path `/<sourceId>/<relative/...>`  
  e.g. `example://examples/sipeed/basic/hello.py`.
- Default open from the tree **seeds** content into `ExampleFileSystemProvider` (writable buffer). **Save** does **not** overwrite the cache; it prompts **Save As** to a real path.
- **Restart restore**: VS Code may reopen `example://` tabs while the in-memory map is empty. Provider must **lazy-hydrate** from `sourcesRoot` on `stat` / `readFile` (path join under cache; block `..` escape). Without cache (never refreshed / deleted), open still fails until Refresh.
- Pure virtual edits that were never saved to disk are lost on restart; rehydrate loads the on-disk cache version.

### Open modes

| Action | Behavior |
|--------|----------|
| Click file in Example tree | Virtual `example://` editor (safe edit + Save As) |
| Context: **Open Source File (may be overwritten)** (`maixcode.openExampleSource`) | Real `file://` path under cache (or local folder) |

- **`local_folder`**: open source with **no** overwrite warning (user-owned tree).
- **`sipeed` / `github_repo`**: non-modal soft warning that Refresh may overwrite; no modal confirm.
- Implementation: `ExampleFileProvider.openFile(uri, source?, sourceId?)`.

### Tree `contextValue`s (Example)

- `exampleSource` — first-level source root (refresh source menu).
- `folder` / `file` — nested nodes; `file` gets open-source context menu.

## Dev loop in VS Code

- F5 → `.vscode/launch.json` “Run Extension” → preLaunch default build task = `npm: watch` (webpack watch) → Extension Development Host with `dist/**/*.js`.
- `.vscode/tasks.json` also has `watch-tests` for `out/` test compile.

## Tests

- Specs: `src/test/**/*.test.ts` → compiled to `out/test/**/*.test.js` (see `.vscode-test.mjs`).
- Current suite is a placeholder assert sample; no device/integration harness.
- `yarn run test` needs a desktop VS Code download via `@vscode/test-electron` (not pure headless unit tests).

## Documentation maintenance (agents)

When finishing a change that alters **behavior, architecture, commands, config, or layout** that future agents need:

1. **Update `AGENTS.md` in the same work unit** (same batch of edits / same proposed commit as the code, or a follow-up docs stage if the user prefers split commits).
2. Keep entries **agent-oriented**: facts, paths, IDs, gotchas — not marketing prose.
3. Prefer **small surgical edits** over full rewrites; remove stale claims when they become false.
4. **Related docs** (only if they exist and the change affects their audience):
   - `README.md` — user-facing Chinese product docs; update when UI/commands/settings change for end users.
   - Other markdown the user maintains for the feature (if any). Do not invent new doc files unless asked.
5. Do **not** treat docs as optional cleanup later: if the code lands without doc updates, the next agent will relearn the wrong model.
6. Still follow **Git workflow**: stage docs with the change, **do not auto-commit**; propose message (e.g. include docs in the same `Feat:`/`Fix:` body, or a separate `Docs:` commit if the user splits work).

Skip doc edits for pure typo/internal renames with no agent-visible surface, unless they touch paths listed in Layout.

## Git workflow (agents)

- **Do not commit** unless the user explicitly asks to commit.
- After changes: stage intended files with `git add` when useful, then **print a proposed commit message** for the user to review and submit manually.
- Do **not** `git commit`, `git push`, amend, or rewrite history unless the user explicitly requests it.
- Prefer not to leave a dirty partial commit; leave work staged or unstaged as the user prefers (default: stage related files, show `git status` / diff summary + message draft).

### Commit message style

Match recent history: short subject, optional body. Prefer a type prefix:

| Prefix | Use |
|--------|-----|
| `Feat:` | user-visible feature or capability |
| `Fix:` | bug fix |
| `Refactor:` | structure/cleanup without intended behavior change |
| `Docs:` | markdown / comments only (lowercase ok for docs) |

Examples from this repo:

```
Fix: rehydrate example:// tabs after restart from disk cache
Feat: pluggable example sources (sipeed, local_folder, github_repo)
Refactor: phase-1 decouple services from Instance/UI
docs: refresh AGENTS.md for examples, debug, and architecture
```

Rules:

- Subject: imperative or concise summary; ~72 chars; no trailing period required.
- Body (optional): 1–3 lines on *why* / user impact; wrap ~72; blank line after subject.
- One logical change per commit when the user splits work; do not mix unrelated fixes in one draft message.
- Never put secrets, tokens, or absolute personal paths in the message.


## i18n (en / zh-cn)

- **Static UI** (`package.json` contributes): use `%maixcode....%` keys resolved by `package.nls.json` (English default) and `package.nls.zh-cn.json`.
- **Runtime UI** (toasts, QuickPick, status bar, tree labels, progress): `vscode.l10n.t("English source", ...args)` with placeholders `{0}`, `{1}`, … Message text is the key; translations live in `l10n/bundle.l10n.zh-cn.json` (and optional `bundle.l10n.json` for default).
- **package.json** must set `"l10n": "./l10n"`. Do not webpack the l10n folder away; ship it in the VSIX (root `l10n/` is not in `.vscodeignore`).
- **Display language**: follows VS Code (`Configure Display Language`). Chinese UI when `zh-cn`.
- When adding commands/settings/views: add keys to **both** `package.nls.json` and `package.nls.zh-cn.json`, and wire `%keys%` in `package.json`.
- When adding user-visible runtime strings: wrap with `vscode.l10n.t` and add the same English key + Chinese value to `l10n/bundle.l10n.zh-cn.json` (and `bundle.l10n.json` if maintained).
- Button labels used for `===` comparisons must use the **localized** string for both the button argument and the comparison (capture in a const).
- Image viewer webview: inject localized labels from the extension host (escape for HTML); client `media/image_viewer` may keep short English HUD tokens (HTTP/WS/MJPEG).
- App config editor webview: same pattern — host injects `vscode.l10n.t` labels into HTML; client `media/app_config_editor` keeps short English fallbacks for empty states.

## Conventions / gotchas

- TypeScript `strict`, module `Node16`, `rootDir` `src`.
- ESLint: `@typescript-eslint` naming on imports, prefer `===`, curly braces; `semi` via TS plugin warn.
- When adding commands or views: update **both** `package.json` `contributes` and `src/constants.ts` / registration code.
- Protocol command IDs and pack/unpack in `websocket_service.ts` are device-facing; change carefully and keep binary layout consistent.
- Do not commit `dist/`, `out/`, `node_modules/`, `.vscode-test/`.
- README is user-facing (Chinese); treat this file + `package.json`/source as source of truth over prose.
