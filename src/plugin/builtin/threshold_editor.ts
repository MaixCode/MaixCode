import { Commands } from "../../constants";
import { ImageType } from "../../model/image_type";
import {
  DevicePlugin,
  DevicePluginDisposable,
  DevicePluginHost,
  DevicePluginWebview,
  DevicePluginWebviewPanel,
} from "../types";

type ThresholdState = {
  deviceKey?: string;
  mode: "hsv" | "lab";
  ranges: [number, number, number, number, number, number];
};

const DEFAULT_STATE: ThresholdState = {
  mode: "hsv",
  ranges: [0, 255, 0, 255, 0, 255],
};

export function createThresholdEditorPlugin(): DevicePlugin {
  let disposable: DevicePluginDisposable | undefined;
  let panel: DevicePluginWebviewPanel | undefined;
  let latestFrame: { deviceKey: string; image: Uint8Array } | undefined;
  let state: ThresholdState = { ...DEFAULT_STATE };

  const syncCurrentDevice = async (host: DevicePluginHost): Promise<void> => {
    const current = host.getCurrentDevice();
    if (!current) {
      return;
    }
    state = { ...state, deviceKey: current.key };
    await host.image.setFormat(ImageType.JPEG);
  };

  return {
    manifest: {
      id: "builtin.threshold-editor",
      name: "HSV/LAB Threshold Editor",
      version: "0.1.0",
      main: "builtin",
      apiVersion: "1.0",
      permissions: ["device.frame", "device.imageFormat", "ui.panel", "ui.command", "device.connection"],
      contributes: {
        commands: [
          {
            id: Commands.openPluginThresholdEditor,
            title: "Open HSV/LAB Threshold Editor",
          },
        ],
      },
    },
    async activate(host: DevicePluginHost) {
      const frameSub = host.onDidReceiveFrame((event) => {
        latestFrame = event;
        if (!state.deviceKey) {
          state.deviceKey = event.deviceKey;
        }
        if (panel) {
          void panel.webview.postMessage({
            type: "frame",
            deviceKey: event.deviceKey,
            imageBase64: Buffer.from(event.image).toString("base64"),
          });
        }
      });
      const deviceSub = host.onDidChangeDevice(() => {
        if (!panel) {
          return;
        }
        void syncCurrentDevice(host).then(() => postState(panel!, host, state, latestFrame));
      });
      disposable = host.ui.registerCommand(
        Commands.openPluginThresholdEditor,
        async () => {
          panel?.dispose();
          panel = host.ui.createPanel({
            viewType: "maixcodePluginThresholdEditor",
            title: host.ui.t("HSV/LAB Threshold Editor"),
            column: "beside",
            html: (webview) => getHtml(host, webview),
            onMessage: async (message) => {
              const payload = message as { type?: string; mode?: "hsv" | "lab"; ranges?: number[]; action?: string };
              if (payload.type === "ready") {
                await syncCurrentDevice(host);
                await postState(panel!, host, state, latestFrame);
                return;
              }
              if (payload.type === "update" && payload.mode && payload.ranges?.length === 6) {
                state = {
                  ...state,
                  mode: payload.mode,
                  ranges: payload.ranges as ThresholdState["ranges"],
                };
                return;
              }
              if (payload.type === "export") {
                const doc = await host.ui.openTextDocument({
                  language: "json",
                  content: JSON.stringify(
                    {
                      colorSpace: state.mode,
                      min: [state.ranges[0], state.ranges[2], state.ranges[4]],
                      max: [state.ranges[1], state.ranges[3], state.ranges[5]],
                    },
                    null,
                    2
                  ),
                });
                await host.ui.showTextDocument(doc, "active", false);
              }
            },
          });
          panel.onDidDispose(() => {
            panel = undefined;
          });
        }
      );
      const commandDisposable = disposable;
      const all: DevicePluginDisposable = {
        dispose() {
          frameSub.dispose();
          deviceSub.dispose();
          commandDisposable?.dispose();
        },
      };
      disposable = all;
    },
    async deactivate() {
      disposable?.dispose();
      disposable = undefined;
      panel?.dispose();
      panel = undefined;
    },
  };
}

async function postState(
  panel: DevicePluginWebviewPanel,
  host: DevicePluginHost,
  state: ThresholdState,
  latestFrame?: { deviceKey: string; image: Uint8Array }
): Promise<void> {
  const hasDevice = Boolean(host.getCurrentDevice());
  await panel.webview.postMessage({
    type: "init",
    devices: host.getConnectedDevices().map((device) => ({ key: device.key, name: device.name })),
    state,
    hasDevice,
    emptyText: hasDevice
      ? undefined
      : host.ui.t("No device connected. Connect a MaixCAM from the MaixCode sidebar first."),
    imageBase64: latestFrame && latestFrame.deviceKey === state.deviceKey
      ? Buffer.from(latestFrame.image).toString("base64")
      : undefined,
  });
}

function getHtml(host: DevicePluginHost, webview: DevicePluginWebview): string {
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data: blob:`,
  ].join("; ");
  const title = escapeHtml(host.ui.t("HSV/LAB Threshold Editor"));
  const exportText = escapeHtml(host.ui.t("Export JSON"));
  const hint = escapeHtml(host.ui.t("Threshold preview runs locally on the latest device frame."));
  const waitingText = escapeHtml(host.ui.t("Connect a MaixCAM to start previewing frames."));
  const script = webview.asWebviewUri(host.ui.asExtensionUri("media/plugin_threshold_editor.js"));
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
    .controls { padding: 16px; border-right: 1px solid var(--vscode-panel-border); }
    .preview { padding: 16px; display: grid; gap: 12px; }
    .empty { display: none; padding: 24px; border: 1px dashed var(--vscode-panel-border); border-radius: 10px; color: var(--vscode-descriptionForeground); }
    .row { display: grid; gap: 8px; margin-bottom: 12px; }
    .pair { display: grid; grid-template-columns: 1fr 72px 72px; gap: 8px; align-items: center; }
    .pair input[type="range"] { width: 100%; }
    .canvases { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    canvas, img { width: 100%; background: #111; border-radius: 10px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    button, select { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 8px 12px; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .controls { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); } .canvases { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="layout">
    <section class="controls">
      <div class="toolbar">
        <h2>${title}</h2>
        <button id="exportBtn">${exportText}</button>
      </div>
      <div class="row">
        <label for="modeSelect">Mode</label>
        <select id="modeSelect">
          <option value="hsv">HSV</option>
          <option value="lab">LAB</option>
        </select>
      </div>
      <div class="row" id="ranges"></div>
      <p class="hint">${hint}</p>
    </section>
    <section class="preview">
      <div id="emptyState" class="empty">${waitingText}</div>
      <div class="canvases">
        <div>
          <div>Source</div>
          <img id="sourceImage" alt="source" />
        </div>
        <div>
          <div>Mask</div>
          <canvas id="maskCanvas"></canvas>
        </div>
      </div>
    </section>
  </div>
  <script src="${script}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
