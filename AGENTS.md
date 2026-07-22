# AGENTS.md

VS Code extension for MaixCAM / MaixPy (discover devices, connect, run/debug code, live image).

## Package manager

- Use **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Yarn lock/config are being removed.
- `package.json` scripts still say `yarn run ...` in `pretest` / `vscode:prepublish`; prefer `pnpm run <script>` when invoking by hand.
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
| `src/instance.ts` | singleton wiring services + UI |
| `src/constants.ts` | command IDs + debug type (`maixpy`) — keep in sync with `package.json` `contributes` |
| `src/command.ts` | command registration |
| `src/service/` | discovery, device manager/service, websocket protocol, image HTTP server |
| `src/model/` | device/status/image types (lowercase dirs; do not reintroduce `Model`/`Service`) |
| `src/ui/` | sidebar, status bar, tree providers, image viewer webview |
| `src/debugger/` | inline Debug Adapter (not a separate Python process) |
| `dist/` | webpack output; `package.json` `main` |
| `out/` | tsc test output only (gitignored) |

Webpack: single Node target bundle `src/extension.ts` → `dist/extension.js`; `vscode` is external. Source maps: dev `nosources-source-map`, package `hidden-source-map`.

## Runtime / product facts agents miss

- **Activation**: `"activationEvents": ["*"]` — loads early; discovery starts in `activate`.
- **Discovery**: mDNS over each non-internal IPv4 NIC; looks for PTR `_ssh._tcp.local` with name prefix `maixcam`, then A records. Loop interval ~3s; stale devices drop after ~4s.
- **Device control**: WebSocket `ws://<ip>:7899`, binary framing (magic header + version + command IDs in `websocket_service.ts`). Auth payload string is `"maixvision"`.
- **Images**: device frames via WS; local Express image service + webview (`image_service` / `image_viewer`). Viewer defaults include `http://localhost:9090`.
- **Examples**: downloaded from `https://cdn.sipeed.com/maixvision/examples` (axios + zip), not shipped under `resources/`.
- **Debug type** `maixpy`: registered as **inline** `DebugAdapterDescriptorFactory` in `debugger/debugger.ts`. Ignore `contributes.debuggers.program` (`./out/debugger.js` + `"runtime": "python"`) for how the adapter actually runs — that manifest path is stale relative to the TS implementation.
- **Commands**: IDs live in `Commands` namespace; tree `contextValue`s like `maixcode-deviceIp` gate menus in `package.json`.
- **Config**: only `maixcode.enableDeviceDiscovery` is contributed (discovery code may not fully honor it yet — check before assuming).
- **Logging**: output channel via `logger.ts` (`initLogger` in activate).

## Dev loop in VS Code

- F5 → `.vscode/launch.json` “Run Extension” → preLaunch default build task = `npm: watch` (webpack watch) → Extension Development Host with `dist/**/*.js`.
- `.vscode/tasks.json` also has `watch-tests` for `out/` test compile.

## Tests

- Specs: `src/test/**/*.test.ts` → compiled to `out/test/**/*.test.js` (see `.vscode-test.mjs`).
- Current suite is a placeholder assert sample; no device/integration harness.
- `pnpm run test` needs a desktop VS Code download via `@vscode/test-electron` (not pure headless unit tests).

## Conventions / gotchas

- TypeScript `strict`, module `Node16`, `rootDir` `src`.
- ESLint: `@typescript-eslint` naming on imports, prefer `===`, curly braces; `semi` via TS plugin warn.
- When adding commands or views: update **both** `package.json` `contributes` and `src/constants.ts` / registration code.
- Protocol command IDs and pack/unpack in `websocket_service.ts` are device-facing; change carefully and keep binary layout consistent.
- Do not commit `dist/`, `out/`, `node_modules/`, `.vscode-test/`.
- README is user-facing (Chinese); treat this file + `package.json`/source as source of truth over prose.

## Example sources

- Tree first level = source `id` / label from `maixcode.exampleSources`.
- Types: `sipeed` (CDN zip), `local_folder` (`path`), `github_repo` (`owner`/`repo`/`ref`/`subdir`).
- Cache layout: `globalStorage/cache/sources/<id>/...`
- Virtual editor path: `example://examples/<id>/...`
- Refresh: command **MaixCode: Refresh Examples** (all sources).

