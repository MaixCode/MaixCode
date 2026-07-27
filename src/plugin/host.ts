import * as vscode from "vscode";
import { ConfigKeys, ConfigSection } from "../constants";
import { info } from "../logger";
import { Status } from "../model/status";
import { ImageType } from "../model/image_type";
import { DeviceManager } from "../service/device_manager";
import { ImageService } from "../service/image_service";
import { readSshCredentials } from "../service/ssh/credentials";
import { SshSession } from "../service/ssh/ssh_session";
import { SshTerminalService } from "../service/ssh/ssh_terminal_service";
import type { OpenSshTerminalRequest } from "../service/ssh/types";
import { log } from "../logger";
import {
  DevicePluginConfig,
  DevicePluginContext,
  DevicePluginDisposable,
  DevicePluginHost,
  DevicePluginImage,
  DevicePluginSsh,
  DevicePluginTextDocument,
  DevicePluginUi,
  DevicePluginViewColumn,
  DevicePluginWebview,
  DevicePluginWebviewPanel,
  DevicePluginWs,
  ExecuteOptions,
  ExecuteResult,
  FrameEvent,
  OutputEvent,
  PluginApiVersion,
  SshExecOptions,
  SshExecResult,
} from "./types";

function toViewColumn(column?: DevicePluginViewColumn): vscode.ViewColumn | undefined {
  switch (column) {
    case "active":
      return vscode.ViewColumn.Active;
    case "one":
      return vscode.ViewColumn.One;
    case "two":
      return vscode.ViewColumn.Two;
    case "three":
      return vscode.ViewColumn.Three;
    case "beside":
    default:
      return vscode.ViewColumn.Beside;
  }
}

function fromTextDocument(document: vscode.TextDocument): DevicePluginTextDocument {
  return {
    uri: document.uri.toString(),
    languageId: document.languageId,
    getText: () => document.getText(),
  };
}

function createPluginDisposable(disposable: vscode.Disposable): DevicePluginDisposable {
  return {
    dispose() {
      disposable.dispose();
    },
  };
}

function createPluginWebview(webview: vscode.Webview): DevicePluginWebview {
  return {
    get cspSource() {
      return webview.cspSource;
    },
    asWebviewUri(path: string): string {
      return webview.asWebviewUri(vscode.Uri.parse(path)).toString();
    },
    postMessage(message: unknown): Promise<boolean> {
      return Promise.resolve(webview.postMessage(message));
    },
  };
}

function toUri(value: string): vscode.Uri {
  return value.startsWith("file:") || value.startsWith("vscode-")
    ? vscode.Uri.parse(value)
    : vscode.Uri.file(value);
}

function createPluginWebviewPanel(panel: vscode.WebviewPanel): DevicePluginWebviewPanel {
  const pluginWebview = createPluginWebview(panel.webview);
  return {
    get viewType() {
      return panel.viewType;
    },
    get title() {
      return panel.title;
    },
    set title(value: string) {
      panel.title = value;
    },
    webview: pluginWebview,
    reveal(column?: DevicePluginViewColumn) {
      panel.reveal(toViewColumn(column), true);
    },
    onDidDispose(listener: () => void): DevicePluginDisposable {
      return createPluginDisposable(panel.onDidDispose(listener));
    },
    dispose() {
      panel.dispose();
    },
  };
}

type DeviceView = {
  key: string;
  name: string;
  ip: string;
  status: DevicePluginContext["status"];
  info?: DevicePluginContext["info"];
  capabilities: DevicePluginContext["capabilities"];
};

function createDeviceContext(view: DeviceView): DevicePluginContext {
  return {
    ...view,
    supports(capability) {
      return Boolean(view.capabilities[capability]);
    },
  };
}

function toDeviceView(
  device: ReturnType<DeviceManager["getConnectedDevice"]>[number]
): DeviceView {
  const key = device.device?.name || device.device?.ip || "Undefined";
  const name = device.device?.name || "Unknown";
  const ip = device.device?.ip || "";
  const status =
    device.status === Status.running
      ? "running"
      : device.status === Status.online
        ? "online"
        : "offline";
  return {
    key,
    name,
    ip,
    status,
    info: device.getDeviceInfo(),
    capabilities: {
      info: true,
      connection: true,
      frame: true,
      imageFormat: true,
      run: true,
      stop: true,
      ws: true,
      runtime: true,
      sshShell: true,
      sftp: true,
    },
  };
}

class HostImageApi implements DevicePluginImage {
  constructor(
    private readonly imageService: ImageService,
    private readonly deviceManager: DeviceManager
  ) {}

  async setFormat(format: ImageType | "none"): Promise<void> {
    const current = this.deviceManager.getCurrentDevice();
    if (!current) {
      return;
    }
    current.setImageFormat(format === "none" ? ImageType.None : format);
  }

  async subscribe(deviceKey?: string): Promise<void> {
    void deviceKey;
  }

  async getLatestFrame(deviceKey?: string): Promise<Uint8Array | undefined> {
    if (!deviceKey) {
      return undefined;
    }
    const item = this.imageService.store.getFrame(deviceKey);
    if (!item) {
      return undefined;
    }
    return new Uint8Array(item.buffer);
  }
}

class HostSshApi implements DevicePluginSsh {
  constructor(
    private readonly deviceManager: DeviceManager,
    private readonly openTerminalForCurrentDevice: () => Promise<void>
  ) {}

  async exec(command: string, options?: SshExecOptions): Promise<SshExecResult> {
    const current = this.deviceManager.getCurrentDevice();
    const host = current?.device?.ip;
    if (!host) {
      throw new Error("No connected device");
    }

    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const port = cfg.get<number>(ConfigKeys.sshPort, 22);
    const timeoutMs = options?.timeoutMs ?? cfg.get<number>(ConfigKeys.sshConnectTimeoutMs, 10000);
    const credentials = readSshCredentials(cfg);
    if (!credentials.length) {
      throw new Error("No SSH credentials configured (maixcode.sshCredentials).");
    }

    const session = new SshSession();
    try {
      await session.connectWithCredentialFallback({
        host,
        port,
        timeoutMs,
        credentials,
      });
      return await new Promise<SshExecResult>((resolve, reject) => {
        const client = (session as unknown as { client?: import("@cweijan/ssh2").Client }).client;
        if (!client) {
          reject(new Error("SSH client is not connected"));
          return;
        }
        const wrapped = options?.cwd
          ? `cd ${shellEscape(options.cwd)} && ${command}`
          : command;
        client.exec(wrapped, (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          let stdout = "";
          let stderr = "";
          let exitCode = 0;
          stream.on("data", (data: Buffer | string) => {
            stdout += typeof data === "string" ? data : data.toString("utf8");
          });
          stream.stderr?.on("data", (data: Buffer | string) => {
            stderr += typeof data === "string" ? data : data.toString("utf8");
          });
          stream.on("exit", (code?: number) => {
            exitCode = typeof code === "number" ? code : 0;
          });
          stream.on("close", () => {
            resolve({ code: exitCode, stdout, stderr });
          });
          stream.on("error", (streamErr: Error) => {
            reject(streamErr);
          });
        });
      });
    } finally {
      session.dispose();
    }
  }

  async openTerminal(): Promise<void> {
    await this.openTerminalForCurrentDevice();
  }

  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.exec(`cat ${shellEscape(path)}`);
    return new TextEncoder().encode(result.stdout);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const text = new TextDecoder().decode(data);
    const payload = Buffer.from(text, "utf8").toString("base64");
    await this.exec(`printf '%s' '${payload}' | base64 -d > ${shellEscape(path)}`);
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export class DevicePluginHostAdapter implements DevicePluginHost {
  public readonly apiVersion: PluginApiVersion = "1.0";
  public readonly ws: DevicePluginWs = {
    async send() {
      throw new Error("WS bridge is not implemented yet");
    },
    async request<T>() {
      throw new Error("WS request bridge is not implemented yet");
      return undefined as T;
    },
  };

  public readonly image: DevicePluginImage;
  public readonly ssh: DevicePluginSsh;
  public readonly ui: DevicePluginUi;
  public readonly config: DevicePluginConfig;

  private readonly onDidChangeDeviceEmitter = new vscode.EventEmitter<void>();
  private readonly onDidReceiveFrameEmitter = new vscode.EventEmitter<FrameEvent>();
  private readonly onDidReceiveOutputEmitter = new vscode.EventEmitter<OutputEvent>();

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly deviceManager: DeviceManager,
    imageService: ImageService,
    private readonly sshTerminalService: SshTerminalService
  ) {
    this.image = new HostImageApi(imageService, deviceManager);
    this.ssh = new HostSshApi(deviceManager, () => this.openCurrentDeviceTerminal());
    this.ui = {
      async openSidebar(viewId: string) {
        await vscode.commands.executeCommand(viewId);
      },
      async openPanel(viewId: string) {
        await vscode.commands.executeCommand("workbench.action.openView", viewId);
      },
      showInformationMessage(message, ...items) {
        return vscode.window.showInformationMessage(message, ...items);
      },
      showWarningMessage(message, ...items) {
        return vscode.window.showWarningMessage(message, ...items);
      },
      showErrorMessage(message, ...items) {
        return vscode.window.showErrorMessage(message, ...items);
      },
      showInputBox(options) {
        return vscode.window.showInputBox(options);
      },
      showQuickPick(items, options) {
        return vscode.window.showQuickPick(items, options);
      },
      createOutputChannel(name: string) {
        const channel = vscode.window.createOutputChannel(name);
        return {
          name,
          append(value: string) {
            channel.append(value);
          },
          appendLine(value: string) {
            channel.appendLine(value);
          },
          clear() {
            channel.clear();
          },
          show(preserveFocus?: boolean) {
            channel.show(Boolean(preserveFocus));
          },
          hide() {
            channel.hide();
          },
          dispose() {
            channel.dispose();
          },
        };
      },
      asExtensionUri: (path: string) =>
        vscode.Uri.joinPath(this.extensionContext.extensionUri, path).toString(),
      async openTextDocument(options) {
        const document = await vscode.workspace.openTextDocument(options);
        return fromTextDocument(document);
      },
      async showTextDocument(document, column, preserveFocus) {
        const textDocument = await vscode.workspace.openTextDocument(vscode.Uri.parse(document.uri));
        await vscode.window.showTextDocument(
          textDocument,
          toViewColumn(column) ?? vscode.ViewColumn.Active,
          preserveFocus
        );
      },
      t(message: string, ...args: Array<string | number | boolean>): string {
        return vscode.l10n.t(message, ...args);
      },
      createPanel: ({ viewType, title, column, html, onMessage, localResourceRoots }) => {
        const panel = vscode.window.createWebviewPanel(
          viewType,
          title,
          toViewColumn(column) ?? vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: (localResourceRoots ?? [
              vscode.Uri.joinPath(this.extensionContext.extensionUri).toString(),
            ]).map((root) => toUri(root)),
          }
        );
        const pluginPanel = createPluginWebviewPanel(panel);
        panel.webview.html = html(pluginPanel.webview);
        if (onMessage) {
          panel.webview.onDidReceiveMessage((message) => {
            void onMessage(message, pluginPanel);
          });
        }
        return pluginPanel;
      },
      registerCommand(id: string, handler: () => void | Promise<void>) {
        log(`Registering command: ${id}`);
        return createPluginDisposable(vscode.commands.registerCommand(id, handler));
      },
    };
    this.config = {
      get<T>(key: string): T | undefined {
        return vscode.workspace.getConfiguration(ConfigSection).get<T>(key);
      },
      async update<T>(key: string, value: T): Promise<void> {
        await vscode.workspace
          .getConfiguration(ConfigSection)
          .update(key, value, vscode.ConfigurationTarget.Global);
      },
    };

    imageService.store.subscribeAll((frame) => {
      this.onDidReceiveFrameEmitter.fire({
        deviceKey: frame.key,
        image: new Uint8Array(frame.buffer),
      });
    });
  }

  public notifyDevicesChanged(): void {
    this.onDidChangeDeviceEmitter.fire();
  }

  public notifyDeviceOutput(deviceKey: string, text: string): void {
    this.onDidReceiveOutputEmitter.fire({ deviceKey, text });
  }

  /** @internal called via registry-scoped wrapper */
  log(message: string, pluginId?: string): void {
    const prefix = pluginId ? `[Plugin:${pluginId}]` : "[Plugin]";
    info(`${prefix} ${message}`);
  }

  getCurrentDevice(): DevicePluginContext | undefined {
    const current = this.deviceManager.getCurrentDevice();
    if (!current?.device || !current.wss?.isConnected) {
      return undefined;
    }
    return createDeviceContext(toDeviceView(current));
  }

  getConnectedDevices(): DevicePluginContext[] {
    return this.deviceManager.getConnectedDevice().map((device) =>
      createDeviceContext(toDeviceView(device))
    );
  }

  onDidChangeDevice(listener: () => void): DevicePluginDisposable {
    return createPluginDisposable(this.onDidChangeDeviceEmitter.event(listener));
  }

  onDidReceiveFrame(listener: (event: FrameEvent) => void): DevicePluginDisposable {
    return createPluginDisposable(this.onDidReceiveFrameEmitter.event(listener));
  }

  onDidReceiveOutput(listener: (event: OutputEvent) => void): DevicePluginDisposable {
    return createPluginDisposable(this.onDidReceiveOutputEmitter.event(listener));
  }

  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    return this.runCode(options.code);
  }

  async runCode(code: string): Promise<ExecuteResult> {
    const current = this.deviceManager.getCurrentDevice();
    if (!current?.wss) {
      return { code: -1, msg: "No connected device" };
    }
    current.wss.runCode(code);
    return { code: 0, msg: "Sent" };
  }

  async stop(): Promise<void> {
    const current = this.deviceManager.getCurrentDevice();
    if (!current?.wss) {
      return;
    }
    await current.wss.stopAndWait();
  }

  private async openCurrentDeviceTerminal(): Promise<void> {
    const current = this.deviceManager.getCurrentDevice();
    const host = current?.device?.ip;
    if (!host) {
      throw new Error("No connected device");
    }
    const request: OpenSshTerminalRequest = {
      host,
      deviceName: current.device?.name,
    };
    await this.sshTerminalService.open(request);
  }
}
