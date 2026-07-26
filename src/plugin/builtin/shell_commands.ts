import { Commands } from "../../constants";
import {
  DevicePlugin,
  DevicePluginDisposable,
  DevicePluginHost,
  DevicePluginWebview,
  DevicePluginWebviewPanel,
} from "../types";

const PRESET_COMMANDS = [
  { label: "uname -a", command: "uname -a" },
  { label: "python version", command: "python3 --version || python --version" },
  { label: "disk usage", command: "df -h" },
  { label: "memory", command: "free -h || cat /proc/meminfo | head -20" },
  { label: "processes", command: "ps" },
  { label: "network", command: "ip addr || ifconfig" },
  { label: "dmesg tail", command: "dmesg | tail -50" },
];

type ShellViewState = {
  command: string;
  output: string;
  busy: boolean;
};

const DEFAULT_STATE: ShellViewState = {
  command: "",
  output: "",
  busy: false,
};

export function createShellCommandsPlugin(): DevicePlugin {
  let disposable: DevicePluginDisposable | undefined;
  let panel: DevicePluginWebviewPanel | undefined;
  let state: ShellViewState = { ...DEFAULT_STATE };

  return {
    manifest: {
      id: "builtin.shell-commands",
      name: "MaixCAM Shell Commands",
      version: "0.1.0",
      main: "builtin",
      apiVersion: "1.0",
      permissions: ["ssh.shell", "ui.command", "ui.panel", "device.connection"],
      contributes: {
        commands: [
          {
            id: Commands.openPluginShellCommands,
            title: "Open MaixCAM Shell Commands",
          },
        ],
      },
    },
    async activate(host: DevicePluginHost) {
      const deviceSub = host.onDidChangeDevice(() => {
        if (!panel) {
          return;
        }
        void postState(panel, host, state);
      });
      disposable = host.ui.registerCommand(
        Commands.openPluginShellCommands,
        async () => {
          if (panel) {
            panel.reveal("beside");
            await postState(panel, host, state);
            return;
          }
          panel = host.ui.createPanel({
            viewType: "maixcodePluginShellCommands",
            title: host.ui.t("MaixCAM Shell Commands"),
            column: "beside",
            html: (webview) => getHtml(host, webview),
            onMessage: async (message) => {
              const payload = message as {
                type?: string;
                command?: string;
              };
              if (payload.type === "ready") {
                await postState(panel!, host, state);
                return;
              }
              if (payload.type === "updateCommand") {
                state = {
                  ...state,
                  command: payload.command || "",
                };
                return;
              }
              if (payload.type === "clearOutput") {
                state = {
                  ...state,
                  output: "",
                };
                await postState(panel!, host, state);
                return;
              }
              if (payload.type === "openTerminal") {
                try {
                  await host.ssh.openTerminal();
                } catch (error) {
                  state = {
                    ...state,
                    output: `${state.output}${formatError(error)}\n`,
                  };
                  await postState(panel!, host, state);
                }
                return;
              }
              if (payload.type === "run") {
                state = await runCommand(host, payload.command || state.command || "", state, panel!);
              }
            },
          });
          panel.onDidDispose(() => {
            panel = undefined;
          });
        }
      );
      const commandDisposable = disposable;
      disposable = {
        dispose() {
          deviceSub.dispose();
          commandDisposable?.dispose();
        },
      };
    },
    async deactivate() {
      disposable?.dispose();
      disposable = undefined;
      panel?.dispose();
      panel = undefined;
    },
  };
}

async function runCommand(
  host: DevicePluginHost,
  command: string,
  currentState: ShellViewState,
  panel: DevicePluginWebviewPanel
): Promise<ShellViewState> {
  const trimmed = command.trim();
  if (!trimmed) {
    return currentState;
  }
  let nextState: ShellViewState = {
    ...currentState,
    command,
    busy: true,
  };
  await postState(panel, host, nextState);
  const startedAt = new Date().toLocaleTimeString();
  nextState = {
    ...nextState,
    output: `${nextState.output}$ ${trimmed}\n[${startedAt}] ${host.ui.t("Running command...")}\n`,
  };
  await postState(panel, host, nextState);
  try {
    const result = await host.ssh.exec(trimmed);
    if (result.stdout) {
      nextState = {
        ...nextState,
        output: `${nextState.output}${result.stdout}${result.stdout.endsWith("\n") ? "" : "\n"}`,
      };
    }
    if (result.stderr) {
      nextState = {
        ...nextState,
        output: `${nextState.output}[stderr]\n${result.stderr}${result.stderr.endsWith("\n") ? "" : "\n"}`,
      };
    }
    nextState = {
      ...nextState,
      busy: false,
      output: `${nextState.output}[exit ${result.code}]\n`,
    };
  } catch (error) {
    nextState = {
      ...nextState,
      busy: false,
      output: `${nextState.output}${formatError(error)}\n`,
    };
  }
  await postState(panel, host, nextState);
  return nextState;
}

async function postState(
  panel: DevicePluginWebviewPanel,
  host: DevicePluginHost,
  state: ShellViewState
): Promise<void> {
  const currentDevice = host.getCurrentDevice();
  await panel.webview.postMessage({
    type: "state",
    state,
    currentDeviceName: currentDevice?.name,
    currentDeviceIp: currentDevice?.ip,
    hasDevice: Boolean(currentDevice),
    presets: PRESET_COMMANDS,
    labels: {
      disconnected: host.ui.t("No device connected"),
      waiting: host.ui.t("Connect a MaixCAM to run shell commands."),
      connected: currentDevice
        ? host.ui.t("Connected device: {0}", `${currentDevice.name} (${currentDevice.ip})`)
        : undefined,
      ready: host.ui.t("Ready."),
    },
  });
}

function getHtml(host: DevicePluginHost, webview: DevicePluginWebview): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
  ].join("; ");
  const title = escapeHtml(host.ui.t("MaixCAM Shell Commands"));
  const description = escapeHtml(host.ui.t("Run shell commands over SSH on the current device."));
  const runText = escapeHtml(host.ui.t("Run Command"));
  const terminalText = escapeHtml(host.ui.t("Open SSH Terminal"));
  const clearText = escapeHtml(host.ui.t("Clear Output"));
  const commandText = escapeHtml(host.ui.t("Command"));
  const presetText = escapeHtml(host.ui.t("Choose a preset"));
  const outputText = escapeHtml(host.ui.t("Output"));
  const placeholder = escapeHtml(host.ui.t("Custom command"));
  const script = webview.asWebviewUri(host.ui.asExtensionUri("media/plugin_shell_commands.js"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; min-height: 100vh; }
    .sidebar { padding: 16px; border-right: 1px solid var(--vscode-panel-border); display: grid; gap: 14px; align-content: start; }
    .main { padding: 16px; display: grid; gap: 12px; min-height: 0; }
    .title { margin: 0; font-size: 18px; }
    .desc, .status { color: var(--vscode-descriptionForeground); }
    .field { display: grid; gap: 8px; }
    select, textarea, button {
      font: inherit;
      color: inherit;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 8px;
      padding: 10px 12px;
    }
    textarea { min-height: 120px; resize: vertical; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
    .actions button.secondary { background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); border-color: transparent; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12));
      border-radius: 10px;
      padding: 14px;
      min-height: 260px;
      overflow: auto;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); }
    }
  </style>
</head>
<body>
  <div class="layout">
    <section class="sidebar">
      <h2 class="title">${title}</h2>
      <div class="desc">${description}</div>
      <div id="deviceStatus" class="status"></div>
      <div class="field">
        <label for="presetSelect">${presetText}</label>
        <select id="presetSelect"></select>
      </div>
      <div class="field">
        <label for="commandInput">${commandText}</label>
        <textarea id="commandInput" placeholder="${placeholder}"></textarea>
      </div>
      <div class="actions">
        <button id="runBtn" class="primary">${runText}</button>
        <button id="terminalBtn" class="secondary">${terminalText}</button>
        <button id="clearBtn" class="secondary">${clearText}</button>
      </div>
    </section>
    <section class="main">
      <div class="field">
        <label for="output">${outputText}</label>
        <pre id="output"></pre>
      </div>
    </section>
  </div>
  <script src="${script}"></script>
</body>
</html>`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
