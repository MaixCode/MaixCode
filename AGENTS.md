# AGENTS.md

VS Code extension for MaixCAM / MaixPy (discover devices, connect, run/debug code, live image, multi-source examples).

## Package manager

- Use **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Yarn lock/config are being removed.
- `package.json` scripts may still say `yarn run ...` in `pretest` / `vscode:prepublish`; prefer `pnpm run <script>` when invoking by hand.
- Native deps: `sharp` (and `canvas` via transitive) need builds; `pnpm-workspace.yaml` sets `allowBuilds` for both. Fresh install may compile natives.

```bash
pnpm install
pnpm run compile          # webpack -> dist/extension.js
pnpm run watch            # default F5 preLaunch task
pnpm run package          # production webpack (vscode:prepublish)
pnpm run lint             # eslint src --ext ts
pnpm run compile-tests    # tsc -> out/ (tests only; extension itself is webpack)
pnpm run test             # pretest = compile-tests + compile + lint, then vscode-test
```

There is no monorepo of packages; workspace file only configures pnpm build allowances.

## Layout

| Path | Role |
|------|------|
| `src/extension.ts` | `activate` / `deactivate` entry |
| `src/instance.ts` | composition root: wires services + UI (singleton) |
| `src/constants.ts` | command IDs + debug type (`maixpy`) — keep in sync with `package.json` `contributes` |
| `src/command.ts` | command registration |
| `src/service/` | discovery, device manager, websocket, image HTTP, run session, example sources |
| `src/service/example_source/` | pluggable example backends (`sipeed`, `local_folder`, `github_repo`) |
| `src/model/` | device/status/image types (lowercase dirs; do not reintroduce `Model`/`Service`) |
| `src/ui/` | sidebar, status bar, tree providers, image viewer webview |
| `src/ui/provider/example.ts` | Example tree + open virtual/source file |
| `src/ui/provider/example_fs.ts` | virtual FS (`example://`) + disk rehydrate |
| `src/debugger/` | inline Debug Adapter (not a separate Python process) |
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
- **SSH terminal**: `SshTerminalService` (`src/service/ssh/`) uses `ssh2` + VS Code `Pseudoterminal` (no system `ssh`). Command `maixcode.openDeviceTerminal`. Credentials: `maixcode.sshCredentials` (array, tried in order; auth fail → next; network fail → stop). Port/timeout: `maixcode.sshPort`, `maixcode.sshConnectTimeoutMs`. Multi-session: each open creates a new terminal. UI: Device tree Open SSH Terminal under Current Device Info + inline on `maixcode-deviceIp`. Host key verifier accepts all (dev convenience). Webpack externals: `ssh2`, `cpu-features`. `pnpm-workspace` allowBuilds for `ssh2` / `cpu-features`.
- **Images**: device frames → `FrameStore` (`frame_store.ts`) via `FrameSink.setImage`; key = device **name** (fallback ip), same as `DeviceService` `onFrame`.
- **ImageService** (`image_service.ts`): local HTTP on `127.0.0.1` (port `maixcode.imageServicePort`, default 9090, fallback ephemeral). Shared store + three transports:
  - HTTP pull: `GET/HEAD /image/:key` (ETag/304, `X-Frame-*` / `X-Image-*` headers; CORS expose)
  - WebSocket: JSON control `subscribe`/`pull`/`ping` + binary frame after `op:frame` meta; push per subscribed key; legacy plain-key message = subscribe pull once
  - MJPEG: `GET /stream/:key` multipart; wait for first frame; backpressure skip
  - Also `GET /keys`, `GET /`. No product HTML under `/view`.
- **ImageViewer** (`ui/provider/image_viewer.ts` + `media/image_viewer/*`): webview panel; no `Instance` import; deps inject listConnected + imageService. Modes HTTP / WebSocket / MJPEG. Config: `imageViewerDefaultMode`, `imageHttpIntervalMs`, `imageViewerAutoStart`. Screenshot via Save dialog (canvas dataUrl or store buffer).
- **Debug type** `maixpy`: registered as **inline** `DebugAdapterDescriptorFactory` in `debugger/debugger.ts`. Do **not** reintroduce stale `contributes.debuggers.program` / `"runtime": "python"` — the adapter is TypeScript, not an external Python program.
- **Run / debug source resolve**: `debugger/source_resolve.ts` maps active editor (including `example://` and untitled) to content/path for launch. Prefer this over assuming `document.uri.fsPath` always works.
- **Stop / busy**: stop should end the debug session (`TerminatedEvent` path). Re-run while code is already running should stop-then-retry rather than silently fail.
- **Commands**: IDs in `Commands` namespace; tree `contextValue`s gate menus (`maixcode-deviceIp`, `exampleSource`, `file`, …).
- **Config**: `maixcode.enableDeviceDiscovery`, `maixcode.autoConnect` (default true), `maixcode.autoConnectTarget` (hostname/IP or empty → last-connected then first). Discovery honors the discovery setting; auto-connect from `onDeviceChanged`.
- **Logging**: output channel via `logger.ts` (`initLogger` in activate).

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
- `pnpm run test` needs a desktop VS Code download via `@vscode/test-electron` (not pure headless unit tests).

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

## Conventions / gotchas

- TypeScript `strict`, module `Node16`, `rootDir` `src`.
- ESLint: `@typescript-eslint` naming on imports, prefer `===`, curly braces; `semi` via TS plugin warn.
- When adding commands or views: update **both** `package.json` `contributes` and `src/constants.ts` / registration code.
- Protocol command IDs and pack/unpack in `websocket_service.ts` are device-facing; change carefully and keep binary layout consistent.
- Do not commit `dist/`, `out/`, `node_modules/`, `.vscode-test/`.
- README is user-facing (Chinese); treat this file + `package.json`/source as source of truth over prose.
