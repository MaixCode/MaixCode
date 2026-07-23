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
    webviewView.webview.html = this.getHtml(webviewView.webview);
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
        vscode.l10n.t("MaixCAM Image"),
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

      this.imagePanel.webview.html = this.getHtml(this.imagePanel.webview);
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
    // Auto-start stream + histogram when webview opens (setting still honored).
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
      default:
        break;
    }
  }

  private async saveScreenshotFromStore(key?: string): Promise<void> {
    if (!key) {
      vscode.window.showWarningMessage(vscode.l10n.t("No device selected for screenshot"));
      return;
    }
    const frame = this.deps.imageService.store.getFrame(key);
    if (!frame) {
      vscode.window.showWarningMessage(vscode.l10n.t("No frame available to save"));
      return;
    }
    const ext = frame.mime.includes("png") ? "png" : "jpg";
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        `maixcam-${key}-${frame.timestamp}.${ext}`
      ),
      filters: { [vscode.l10n.t("Images")]: [ext, "png", "jpg", "jpeg"] },
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(frame.buffer));
    vscode.window.showInformationMessage(vscode.l10n.t("Saved screenshot to {0}", uri.fsPath));
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
      filters: { [vscode.l10n.t("Images")]: ["png"] },
    });
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, buf);
    vscode.window.showInformationMessage(vscode.l10n.t("Saved screenshot to {0}", uri.fsPath));
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private getHtml(webview: vscode.Webview): string {
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

    const tDevice = this.escapeHtml(vscode.l10n.t("Device"));
    const tTransport = this.escapeHtml(vscode.l10n.t("Transport"));
    const tStart = this.escapeHtml(vscode.l10n.t("Start"));
    const tStop = this.escapeHtml(vscode.l10n.t("Stop"));
    const tShot = this.escapeHtml(vscode.l10n.t("Shot"));
    const tScreenshot = this.escapeHtml(vscode.l10n.t("Screenshot"));
    const tInterval = this.escapeHtml(vscode.l10n.t("HTTP poll interval (ms)"));
    const tOverlay = this.escapeHtml(vscode.l10n.t("Show overlay"));
    const tHist = this.escapeHtml(vscode.l10n.t("Color histogram"));
    const tHistSpace = this.escapeHtml(vscode.l10n.t("Histogram color space"));
    const tAuto = this.escapeHtml(vscode.l10n.t("Auto"));
    const tAutoReconnect = this.escapeHtml(vscode.l10n.t("Auto reconnect"));
    const tIdle = this.escapeHtml(vscode.l10n.t("Idle"));
    const tHistogram = this.escapeHtml(vscode.l10n.t("Histogram"));
    const tSettings = this.escapeHtml(vscode.l10n.t("Settings"));
    const tFit = this.escapeHtml(vscode.l10n.t("Fit to view"));
    const tLog = this.escapeHtml(vscode.l10n.t("Log"));
    const tTitle = this.escapeHtml(vscode.l10n.t("MaixCAM Image"));
    // Inline SVG icons (currentColor); titles keep a11y text
    const iconPlay =
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9-5.5L4 2.5z"/></svg>';
    const iconCamera =
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.5 3.5h1.2l.8-1h3l.8 1H12.5A1.5 1.5 0 0 1 14 5v6.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5V5a1.5 1.5 0 0 1 1.5-1.5h2zm2.5 2A2.75 2.75 0 1 0 10.75 8.25 2.75 2.75 0 0 0 8 5.5zm0 1.5a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 8 7z"/></svg>';
    const iconGear =
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9.1 1.2 9.4 3a4.8 4.8 0 0 1 1.3.75l1.7-.7 1.1 1.9-1.4 1.2c.1.35.15.7.15 1.05s-.05.7-.15 1.05l1.4 1.2-1.1 1.9-1.7-.7A4.8 4.8 0 0 1 9.4 12l-.3 1.8H7.2L6.9 12a4.8 4.8 0 0 1-1.3-.75l-1.7.7-1.1-1.9 1.4-1.2A4.6 4.6 0 0 1 4 7.8c0-.35.05-.7.15-1.05L2.75 5.55l1.1-1.9 1.7.7A4.8 4.8 0 0 1 6.9 3.6l.3-1.8h1.9zM8 5.5A2.3 2.3 0 1 0 10.3 7.8 2.3 2.3 0 0 0 8 5.5z"/></svg>';
    const iconClose =
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 3.5 8 8l4.5-4.5 1 1L9 9l4.5 4.5-1 1L8 10l-4.5 4.5-1-1L7 9 2.5 4.5z"/></svg>';
    // expand / fit-to-view (arrows to corners)
    const iconFit =
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2h4v1.5H3.5V6H2V2zm8 0h4v4h-1.5V3.5H10V2zM2 10h1.5v2.5H6V14H2v-4zm10.5 2.5V10H14v4h-4v-1.5h2.5zM5 5h6v6H5V5z"/></svg>';
    const iconLog =
      '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zM3 4v8h10V4H3zm1.5 1.5h7v1h-7v-1zm0 2.5h7v1h-7V8zm0 2.5h5v1h-5v-1z"/></svg>';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${tTitle}</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div class="toolbar">
    <select id="deviceSelect" title="${tDevice}">
      <option value="" disabled selected>${tDevice}</option>
    </select>
    <button type="button" class="btn icon-btn primary stream-toggle" id="streamBtn" disabled title="${tStart}" aria-label="${tStart}" data-start="${tStart}" data-stop="${tStop}">${iconPlay}</button>
    <button type="button" class="btn icon-btn" id="screenshotBtn" disabled title="${tScreenshot}" aria-label="${tScreenshot}">${iconCamera}</button>
    <button type="button" class="btn icon-btn" id="fitViewBtn" title="${tFit}" aria-label="${tFit}">${iconFit}</button>
    <button type="button" class="btn icon-btn" id="logBtn" title="${tLog}" aria-label="${tLog}">${iconLog}</button>
    <button type="button" class="btn icon-btn" id="settingsBtn" title="${tSettings}" aria-label="${tSettings}">${iconGear}</button>
    <span class="status-light idle" id="connectionStatus" title="${tIdle}" aria-label="${tIdle}" role="status"></span>
  </div>
  <div class="settings-panel" id="settingsPanel" hidden>
    <div class="settings-head">
      <span>${tSettings}</span>
      <button type="button" class="btn icon-btn" id="settingsClose" title="Close" aria-label="Close">${iconClose}</button>
    </div>
    <div class="settings-body">
      <div class="settings-row">
        <span class="settings-label">${tTransport}</span>
        <div class="modes" role="group" aria-label="${tTransport}">
          <button type="button" class="stream-mode" data-mode="http">HTTP</button>
          <button type="button" class="stream-mode active" data-mode="websocket">WS</button>
          <button type="button" class="stream-mode" data-mode="mjpeg">MJPEG</button>
        </div>
      </div>
      <label class="settings-row">
        <span class="settings-label">${tInterval}</span>
        <input type="number" id="intervalInput" value="33" min="16" max="2000" step="1" />
      </label>
      <label class="settings-row settings-row-inline">
        <span class="settings-label">${tAutoReconnect}</span>
        <input type="checkbox" id="autoReconnect" checked />
      </label>
      <label class="settings-row settings-row-inline">
        <span class="settings-label">${tOverlay}</span>
        <input type="checkbox" id="overlayToggle" checked />
      </label>
      <label class="settings-row settings-row-inline">
        <span class="settings-label">${tHist}</span>
        <input type="checkbox" id="histogramToggle" checked />
      </label>
      <label class="settings-row">
        <span class="settings-label">${tHistSpace}</span>
        <select id="histSpace">
          <option value="rgb" selected>RGB</option>
          <option value="gray">GRAY</option>
          <option value="lab">LAB</option>
          <option value="yuv">YUV</option>
          <option value="hsv">HSV</option>
        </select>
      </label>
      <label class="settings-row">
        <span class="settings-label">Histogram quality</span>
        <select id="histQuality">
          <option value="160">Fast (max 160)</option>
          <option value="320" selected>Balanced (max 320)</option>
          <option value="640">High (max 640)</option>
          <option value="full">Full resolution</option>
        </select>
      </label>
      <p class="settings-hint">Full uses every pixel; slower on high-res streams.</p>
      <label class="settings-row">
        <span class="settings-label">Hist interval (ms)</span>
        <input type="number" id="histIntervalMs" value="120" min="30" max="1000" step="10" />
      </label>
    </div>
  </div>
  <div class="stage" id="stage">
    <img id="streamImage" alt="" draggable="false" />
    <div class="overlay" id="imageOverlay" style="display:none;">
      <div id="overlayInfo"></div>
    </div>
    <div class="zoom-badge" id="zoomBadge" hidden>100%</div>
  </div>
  <div class="hist-dock" id="histPanel" hidden>
    <div class="hist-resize" id="histResize"></div>
    <div class="hist-dock-head">
      <span class="hist-dock-title">${tHistogram}</span>
      <span class="hist-dock-meta" id="histMeta">-</span>
    </div>
    <div class="hist-charts" id="histCharts"></div>
    <div class="hist-tooltip" id="histTooltip" hidden></div>
  </div>
  <div class="log-panel" id="logPanel" hidden>
    <div class="log-panel-head">
      <span>${tLog}</span>
      <div class="log-panel-actions">
        <button type="button" class="btn" id="logClearBtn">Clear</button>
        <button type="button" class="btn icon-btn" id="logClose" title="Close" aria-label="Close">${iconClose}</button>
      </div>
    </div>
    <div class="log-section" id="logContainer"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
