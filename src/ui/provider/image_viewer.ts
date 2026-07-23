import * as vscode from "vscode";
import { log, warn } from "../../logger";
import { ImageService } from "../../service/image_service";

export interface ImageViewerDevice {
  /** Frame store / HTTP key (device name, matching DeviceService onFrame) */
  key: string;
  name: string;
  ip: string;
}

export interface ImageViewerDeps {
  imageService: ImageService;
  listConnectedDevices: () => ImageViewerDevice[];
  /** Optional: called when connection list may have changed — viewer polls via this if set */
  onConnectionListChanged?: (listener: () => void) => () => void;
}

/** Either editor WebviewPanel or sidebar WebviewView. */
interface ViewerSurface {
  webview: vscode.Webview;
  kind: "panel" | "view";
}

/**
 * Live preview via local ImageService transports (HTTP / WS / MJPEG).
 * Surfaces: secondary-sidebar WebviewView + optional editor WebviewPanel.
 */
export class ImageViewer implements vscode.WebviewViewProvider {
  public static readonly viewId = "maixcode-image";

  private imagePanel: vscode.WebviewPanel | undefined;
  private imageView: vscode.WebviewView | undefined;
  private devicePoll: NodeJS.Timeout | undefined;
  private unsubConnection: (() => void) | undefined;
  private lastDeviceJson = "";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: ImageViewerDeps
  ) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ImageViewer.viewId, this, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
    context.subscriptions.push({
      dispose: () => this.dispose(),
    });
  }

  public dispose(): void {
    this.stopDeviceUpdates();
    this.imagePanel?.dispose();
    this.imagePanel = undefined;
    this.imageView = undefined;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.imageView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media", "image_viewer"),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview, "view");
    const sub = webviewView.webview.onDidReceiveMessage((message) => {
      void this.onMessage(message, webviewView.webview);
    });
    webviewView.onDidDispose(() => {
      sub.dispose();
      if (this.imageView === webviewView) {
        this.imageView = undefined;
      }
      if (!this.hasSurface()) {
        this.stopDeviceUpdates();
      }
    });
    this.startDeviceUpdates();
  }

  /** Focus the secondary-sidebar Image view. */
  public async showSidebar(): Promise<void> {
    await vscode.commands.executeCommand(`${ImageViewer.viewId}.focus`);
  }

  /** Open (or reveal) a larger editor WebviewPanel. */
  public async showWindow(): Promise<void> {
    if (!this.imagePanel) {
      this.imagePanel = vscode.window.createWebviewPanel(
        "maixcodeImagePreview",
        "MaixCAM Image",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(
              this.context.extensionUri,
              "media",
              "image_viewer"
            ),
          ],
          retainContextWhenHidden: true,
        }
      );

      this.imagePanel.onDidDispose(() => {
        this.imagePanel = undefined;
        if (!this.hasSurface()) {
          this.stopDeviceUpdates();
        }
      });

      this.imagePanel.webview.onDidReceiveMessage((message) => {
        void this.onMessage(message, this.imagePanel!.webview);
      });

      this.imagePanel.webview.html = this.getHtml(this.imagePanel.webview, "panel");
      this.startDeviceUpdates();
    } else {
      this.imagePanel.reveal(vscode.ViewColumn.Beside);
      this.postInitTo(this.imagePanel.webview);
    }
  }

  private hasSurface(): boolean {
    return !!(this.imagePanel || this.imageView);
  }

  private surfaces(): ViewerSurface[] {
    const out: ViewerSurface[] = [];
    if (this.imageView) {
      out.push({ webview: this.imageView.webview, kind: "view" });
    }
    if (this.imagePanel) {
      out.push({ webview: this.imagePanel.webview, kind: "panel" });
    }
    return out;
  }

  private startDeviceUpdates(): void {
    if (this.devicePoll || this.unsubConnection) {
      // already running; still push once for new surface
      this.postDeviceList();
      return;
    }
    const push = () => this.postDeviceList();
    push();
    if (this.deps.onConnectionListChanged) {
      this.unsubConnection = this.deps.onConnectionListChanged(push);
    }
    this.devicePoll = setInterval(push, 2000);
  }

  private stopDeviceUpdates(): void {
    if (this.devicePoll) {
      clearInterval(this.devicePoll);
      this.devicePoll = undefined;
    }
    this.unsubConnection?.();
    this.unsubConnection = undefined;
    this.lastDeviceJson = "";
  }

  private devicesPayload(): ImageViewerDevice[] {
    return this.deps.listConnectedDevices();
  }

  private postDeviceList(): void {
    const devices = this.devicesPayload();
    const json = JSON.stringify(devices);
    if (json === this.lastDeviceJson) {
      return;
    }
    this.lastDeviceJson = json;
    for (const s of this.surfaces()) {
      void s.webview.postMessage({
        type: "updateDeviceList",
        devices,
      });
    }
  }

  private postInitTo(webview: vscode.Webview): void {
    const svc = this.deps.imageService;
    const cfg = vscode.workspace.getConfiguration("maixcode");
    const defaultMode = cfg.get<string>("imageViewerDefaultMode", "websocket");
    const httpInterval = cfg.get<number>("imageHttpIntervalMs", 33);
    const autoStart = cfg.get<boolean>("imageViewerAutoStart", true);
    void webview.postMessage({
      type: "init",
      httpBase: svc.getHttpBaseUrl(),
      wsUrl: svc.getWsUrl(),
      devices: this.devicesPayload(),
      defaultMode:
        defaultMode === "http" || defaultMode === "mjpeg"
          ? defaultMode
          : "websocket",
      httpInterval,
      autoStart,
    });
  }

  private async onMessage(
    message: {
      type?: string;
      key?: string;
      mode?: string;
      dataUrl?: string;
    },
    webview: vscode.Webview
  ): Promise<void> {
    if (!message?.type) {
      return;
    }
    switch (message.type) {
      case "ready":
        void this.deps.imageService.whenReady().then(() => {
          this.lastDeviceJson = "";
          this.postInitTo(webview);
        });
        break;
      case "deviceSelected":
        log(`Image viewer selected device key=${message.key}`);
        break;
      case "modeChanged":
        log(`Image viewer mode=${message.mode}`);
        break;
      case "logError":
        warn(`Image viewer: ${String((message as { error?: string }).error)}`);
        break;
      case "screenshot":
        await this.saveScreenshotFromStore(message.key);
        break;
      case "screenshotData":
        await this.saveScreenshotDataUrl(message.key, message.dataUrl);
        break;
      case "openSidebar":
        await this.showSidebar();
        break;
      case "openPanel":
        await this.showWindow();
        break;
      default:
        break;
    }
  }

  private async saveScreenshotFromStore(key?: string): Promise<void> {
    if (!key) {
      vscode.window.showWarningMessage("No device selected for screenshot");
      return;
    }
    const frame = this.deps.imageService.store.getFrame(key);
    if (!frame) {
      vscode.window.showWarningMessage("No frame available to save");
      return;
    }
    const ext = frame.mime.includes("png") ? "png" : "jpg";
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        `maixcam-${key}-${frame.timestamp}.${ext}`
      ),
      filters: { Images: [ext, "png", "jpg", "jpeg"] },
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(frame.buffer));
    vscode.window.showInformationMessage(`Saved screenshot to ${uri.fsPath}`);
  }

  private async saveScreenshotDataUrl(
    key?: string,
    dataUrl?: string
  ): Promise<void> {
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      await this.saveScreenshotFromStore(key);
      return;
    }
    const comma = dataUrl.indexOf(",");
    if (comma < 0) {
      await this.saveScreenshotFromStore(key);
      return;
    }
    const buf = Buffer.from(dataUrl.slice(comma + 1), "base64");
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        `maixcam-${key || "shot"}-${Date.now()}.png`
      ),
      filters: { Images: ["png"] },
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, buf);
    vscode.window.showInformationMessage(`Saved screenshot to ${uri.fsPath}`);
  }

  private getHtml(
    webview: vscode.Webview,
    surface: "panel" | "view"
  ): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "image_viewer",
        "main.css"
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "image_viewer",
        "main.js"
      )
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob: http://127.0.0.1:* http://localhost:*`,
      `connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MaixCAM Image</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div class="toolbar">
    <select id="deviceSelect" title="Device">
      <option value="" disabled selected>Device</option>
    </select>
    <div class="modes" role="group" aria-label="Transport">
      <button type="button" class="stream-mode" data-mode="http">HTTP</button>
      <button type="button" class="stream-mode active" data-mode="websocket">WS</button>
      <button type="button" class="stream-mode" data-mode="mjpeg">MJPEG</button>
    </div>
    <button type="button" class="btn primary" id="startBtn" disabled>Start</button>
    <button type="button" class="btn" id="stopBtn" disabled>Stop</button>
    <button type="button" class="btn" id="screenshotBtn" disabled title="Screenshot">Shot</button>
    ${
      surface === "panel"
        ? `<button type="button" class="btn" id="openSidebarBtn" title="Open in secondary sidebar">Sidebar</button>`
        : `<button type="button" class="btn" id="openPanelBtn" title="Open in editor panel">Editor</button>`
    }
    <input type="number" id="intervalInput" value="33" min="16" max="2000" step="1" title="HTTP poll interval (ms)" />
    <label class="chk" title="Show overlay"><input type="checkbox" id="overlayToggle" checked /> HUD</label>
    <label class="chk" title="Auto reconnect"><input type="checkbox" id="autoReconnect" checked /> Auto</label>
    <div class="status idle" id="connectionStatus">Idle</div>
    <div class="metrics-inline" title="FPS · KB · resolution · latency">
      <span><b id="fpsValue">0</b> fps</span>
      <span><b id="frameSizeValue">0</b> KB</span>
      <span id="resolutionValue">-</span>
      <span id="latencyValue">-</span>
    </div>
  </div>
  <div class="stage">
    <img id="streamImage" alt="" />
    <div class="overlay" id="imageOverlay" style="display:none;">
      <div id="overlayInfo"></div>
    </div>
  </div>
  <div class="footer">
    <div class="log-section" id="logContainer"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
