const path = require("path");

const pluginDir = __dirname;
const plugin = {
  manifest: {
    id: "sample.device-process-list",
    name: "Device Process List",
    version: "0.1.0",
    main: "index.js",
    apiVersion: "1.0",
    permissions: ["ssh.shell", "ui.command", "ui.panel", "device.connection"],
    contributes: {
      commands: [
        {
          id: "sample.device-process-list.open",
          title: "Open Device Process List",
        },
      ],
    },
  },
  activate(host) {
    host.log("activated");
    let panel;
    let state = {
      busy: false,
      output: "",
      currentDevice: undefined,
    };
    let disposables = [];

    const commandDisposable = host.ui.registerCommand("sample.device-process-list.open", async () => {
      host.log("open requested");
      if (!panel) {
        host.log("create panel");
        panel = host.ui.createPanel({
          viewType: "sampleDeviceProcessList",
          title: host.ui.t("Device Process List"),
          column: "beside",
          localResourceRoots: ["file://" + pluginDir],
          html: (webview) => getHtml(webview),
          onMessage: async (message) => {
            if (message.type === "ready") {
              await postState(panel, host, state);
              return;
            }
            if (message.type === "refresh") {
              host.log("refresh");
              await refresh(host, panel, state);
              return;
            }
            if (message.type === "terminal") {
              host.log("open terminal");
              await host.ssh.openTerminal();
            }
          },
        });
        panel.onDidDispose(() => {
          panel = undefined;
        });
      } else {
        panel.reveal("beside");
      }
      await postState(panel, host, state);
      await refresh(host, panel, state);
    });

    const deviceDisposable = host.onDidChangeDevice(() => {
      if (panel) {
        void postState(panel, host, state);
      }
    });

    const frameDisposable = host.onDidReceiveOutput((event) => {
      if (panel && event.deviceKey === state.currentDevice?.key) {
        state.output = `${state.output}${event.text}`;
        void postState(panel, host, state);
      }
    });

    disposables = [commandDisposable, deviceDisposable, frameDisposable];

    this._dispose = () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      disposables = [];
    };
  },
  async deactivate() {
    if (this._dispose) {
      this._dispose();
      this._dispose = undefined;
    }
  },
  _dispose: undefined
};

async function refresh(host, panel, state) {
  const device = host.getCurrentDevice();
  state.currentDevice = device;
  state.busy = true;
  await postState(panel, host, state);
  if (!device) {
    host.log("refresh aborted: no device");
    state.output = `${state.output}${host.ui.t("No device connected. Connect a MaixCAM from the MaixCode sidebar first.")}\n`;
    state.busy = false;
    await postState(panel, host, state);
    return;
  }
  try {
    host.log(`exec ps on ${device.ip}`);
    const result = await host.ssh.exec("ps");
    state.output = result.stdout || result.stderr || host.ui.t("No process list returned.");
    state.busy = false;
    await postState(panel, host, state);
  } catch (error) {
    host.log(`refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    state.output = `${host.ui.t("Process list failed: {0}", error instanceof Error ? error.message : String(error))}\n`;
    state.busy = false;
    await postState(panel, host, state);
  }
}

async function postState(panel, host, state) {
  if (!panel) {
    return;
  }
  const current = host.getCurrentDevice();
  await panel.webview.postMessage({
    type: "state",
    state: {
      busy: state.busy,
      output: state.output,
      deviceName: current ? `${current.name} (${current.ip})` : host.ui.t("No device connected"),
    },
    labels: {
      title: host.ui.t("Device Process List"),
      subtitle: host.ui.t("Inspect the current device process table."),
      refresh: host.ui.t("Refresh"),
      openTerminal: host.ui.t("Open SSH Terminal"),
      clear: host.ui.t("Clear"),
      noDevice: host.ui.t("No device connected. Connect a MaixCAM from the MaixCode sidebar first."),
      waiting: host.ui.t("Run refresh to fetch processes from the device."),
      processOutput: host.ui.t("Process Output"),
    },
  });
}

function getHtml(webview) {
  const scriptUri = webview.asWebviewUri("file://" + path.join(pluginDir, "view.js"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .layout { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar, .main { padding: 16px; }
    .sidebar { border-right: 1px solid var(--vscode-panel-border); display: grid; gap: 12px; align-content: start; }
    .title { margin: 0; font-size: 18px; }
    .subtitle, .status { color: var(--vscode-descriptionForeground); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { font: inherit; border: none; border-radius: 8px; padding: 8px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12)); border-radius: 10px; padding: 14px; min-height: 420px; overflow: auto; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .sidebar { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); } }
  </style>
</head>
<body>
  <div class="layout">
    <section class="sidebar">
      <h2 id="title" class="title"></h2>
      <div id="subtitle" class="subtitle"></div>
      <div id="device" class="status"></div>
      <div class="actions">
        <button id="refreshBtn"></button>
        <button id="terminalBtn"></button>
        <button id="clearBtn"></button>
      </div>
      <div id="hint" class="hint"></div>
    </section>
    <section class="main">
      <pre id="output"></pre>
    </section>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

module.exports = plugin;
