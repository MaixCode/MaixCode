import { DeviceInfo } from "../model/device";
import { ImageType } from "../model/image_type";

export type PluginApiVersion = "1.0";

export type PluginPermission =
  | "device.info"
  | "device.connection"
  | "device.frame"
  | "device.imageFormat"
  | "device.run"
  | "device.stop"
  | "device.ws"
  | "device.runtime"
  | "ssh.shell"
  | "ssh.sftp"
  | "ui.sidebar"
  | "ui.panel"
  | "ui.command"
  | "config.read"
  | "config.write";

export type DeviceStatus = "offline" | "online" | "running";

export interface DeviceCapabilitySet {
  info?: boolean;
  connection?: boolean;
  frame?: boolean;
  imageFormat?: boolean;
  run?: boolean;
  stop?: boolean;
  ws?: boolean;
  runtime?: boolean;
  sshShell?: boolean;
  sftp?: boolean;
}

export interface DevicePluginContext {
  readonly key: string;
  readonly name: string;
  readonly ip: string;
  readonly status: DeviceStatus;
  readonly info?: DeviceInfo;
  readonly capabilities: DeviceCapabilitySet;

  supports(capability: keyof DeviceCapabilitySet): boolean;
}

export interface FrameEvent {
  readonly deviceKey: string;
  readonly image: Uint8Array;
}

export interface OutputEvent {
  readonly deviceKey: string;
  readonly text: string;
}

export interface ExecuteOptions {
  readonly deviceKey?: string;
  readonly code: string;
}

export interface ExecuteResult {
  readonly code: number;
  readonly msg: string;
}

export interface SshExecOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface SshExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type DeviceCommand = number;

export interface DevicePluginWs {
  send(
    command: DeviceCommand,
    payload: Uint8Array | string | number
  ): Promise<void>;
  request<T>(
    command: DeviceCommand,
    payload?: Uint8Array | string | number
  ): Promise<T>;
}

export interface DevicePluginSsh {
  exec(command: string, options?: SshExecOptions): Promise<SshExecResult>;
  openTerminal(): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

export interface DevicePluginImage {
  setFormat(format: ImageType | "none"): Promise<void>;
  subscribe(deviceKey?: string): Promise<void>;
  getLatestFrame(deviceKey?: string): Promise<Uint8Array | undefined>;
}

export type DevicePluginViewColumn = "active" | "beside" | "one" | "two" | "three";
export type DevicePluginThenable<T> = PromiseLike<T>;

export interface DevicePluginMessageItem {
  readonly title: string;
  readonly isCloseAffordance?: boolean;
}

export interface DevicePluginQuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

export interface DevicePluginInputOptions {
  readonly title?: string;
  readonly value?: string;
  readonly placeHolder?: string;
  readonly prompt?: string;
  readonly password?: boolean;
  readonly ignoreFocusOut?: boolean;
}

export interface DevicePluginQuickPickOptions {
  readonly title?: string;
  readonly placeHolder?: string;
  readonly matchOnDescription?: boolean;
  readonly matchOnDetail?: boolean;
  readonly ignoreFocusOut?: boolean;
}

export interface DevicePluginTextDocumentOptions {
  readonly language?: string;
  readonly content: string;
}

export interface DevicePluginTextDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly getText: () => string;
}

export interface DevicePluginOutputChannel {
  readonly name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
}

export interface DevicePluginWebview {
  readonly cspSource: string;
  asWebviewUri(path: string): string;
  postMessage(message: unknown): DevicePluginThenable<boolean>;
}

export interface DevicePluginWebviewPanel {
  readonly viewType: string;
  title: string;
  readonly webview: DevicePluginWebview;
  reveal(column?: DevicePluginViewColumn): void;
  onDidDispose(listener: () => void): DevicePluginDisposable;
  dispose(): void;
}

export interface DevicePluginDisposable {
  dispose(): void;
}

export interface DevicePluginUi {
  openSidebar(viewId: string): Promise<void>;
  openPanel(viewId: string): Promise<void>;
  showInformationMessage<T extends DevicePluginMessageItem>(
    message: string,
    ...items: T[]
  ): DevicePluginThenable<T | undefined>;
  showWarningMessage<T extends DevicePluginMessageItem>(
    message: string,
    ...items: T[]
  ): DevicePluginThenable<T | undefined>;
  showErrorMessage<T extends DevicePluginMessageItem>(
    message: string,
    ...items: T[]
  ): DevicePluginThenable<T | undefined>;
  showInputBox(options?: DevicePluginInputOptions): DevicePluginThenable<string | undefined>;
  showQuickPick<T extends DevicePluginQuickPickItem>(
    items: readonly T[],
    options?: DevicePluginQuickPickOptions
  ): DevicePluginThenable<T | undefined>;
  createOutputChannel(name: string): DevicePluginOutputChannel;
  asExtensionUri(path: string): string;
  openTextDocument(options: DevicePluginTextDocumentOptions): DevicePluginThenable<DevicePluginTextDocument>;
  showTextDocument(
    document: DevicePluginTextDocument,
    column?: DevicePluginViewColumn,
    preserveFocus?: boolean
  ): DevicePluginThenable<void>;
  t(message: string, ...args: Array<string | number | boolean>): string;
  createPanel(options: {
    viewType: string;
    title: string;
    column?: DevicePluginViewColumn;
    html: (webview: DevicePluginWebview) => string;
    onMessage?: (message: unknown, panel: DevicePluginWebviewPanel) => void | Promise<void>;
    localResourceRoots?: string[];
  }): DevicePluginWebviewPanel;
  registerCommand(id: string, handler: () => void | Promise<void>): DevicePluginDisposable;
}

export interface DevicePluginConfig {
  get<T>(key: string): T | undefined;
  update<T>(key: string, value: T): Promise<void>;
}

export interface DevicePluginHost {
  readonly apiVersion: PluginApiVersion;

  getCurrentDevice(): DevicePluginContext | undefined;
  getConnectedDevices(): DevicePluginContext[];

  onDidChangeDevice(listener: () => void): DevicePluginDisposable;
  onDidReceiveFrame(listener: (event: FrameEvent) => void): DevicePluginDisposable;
  onDidReceiveOutput(listener: (event: OutputEvent) => void): DevicePluginDisposable;

  execute(options: ExecuteOptions): Promise<ExecuteResult>;
  runCode(code: string): Promise<ExecuteResult>;
  stop(): Promise<void>;

  readonly ws: DevicePluginWs;
  readonly ssh: DevicePluginSsh;
  readonly image: DevicePluginImage;
  readonly ui: DevicePluginUi;
  readonly config: DevicePluginConfig;
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly main: string;
  readonly apiVersion: PluginApiVersion;
  readonly permissions: PluginPermission[];
  readonly contributes?: {
    readonly commands?: Array<{
      readonly id: string;
      readonly title: string;
    }>;
    readonly views?: Array<{
      readonly id: string;
      readonly name: string;
    }>;
  };
}

export interface DevicePlugin {
  readonly manifest: PluginManifest;
  activate(host: DevicePluginHost): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
