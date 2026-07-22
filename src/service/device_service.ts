import * as vscode from "vscode";
import { WebSocketService } from "./websocket_service";
import { info, warn, error } from "../logger";
import { DeviceAddr } from "../model/device";
import { Status } from "../model/status";
import { DeviceTransport } from "../ports/device_transport";

export type FrameHandler = (deviceKey: string, data: ArrayBuffer) => void;

export class DeviceService {
  /** Optional hook for list/status UI refresh after connect lifecycle events */
  public onConnectionStateChange?: () => void;
  /** Program run/stop on device (WebSocket isRunning) */
  public onRunStateChange?: (running: boolean) => void;

  constructor(
    private context: vscode.ExtensionContext,
    public device?: DeviceAddr,
    public wss?: WebSocketService,
    private onFrame?: FrameHandler
  ) {}

  public setFrameHandler(handler: FrameHandler | undefined) {
    this.onFrame = handler;
  }

  public connect(device?: DeviceAddr) {
    if (device) {
      this.device = device;
    }
    if (!this.device) {
      error("Device is not set");
      return;
    }
    if (this.wss) {
      warn(`Device ${this.device.name} is already connected or offline`);
      return;
    }
    this.wss = new WebSocketService(this.device.ip);
    this.wss.on("runState", (running: boolean) => {
      this.onRunStateChange?.(running);
    });
    this.wss.on("close", (code, reason) => {
      info(`Device ${this.device?.name} disconnected: ${reason}`);
      this.wss = undefined;
      this.onConnectionStateChange?.();
    });
    this.wss.on("img", (data: ArrayBuffer) => {
      const key = this.device?.name || this.device?.ip || "Undefined";
      this.onFrame?.(key, data);
    });
    this.wss.on("authAck", (content: Uint8Array) => {
      if (content[0] === 1) {
        this.onConnectionStateChange?.();
      }
    });
    this.wss.on("deviceInfo", () => {
      this.onConnectionStateChange?.();
    });
    this.wss.connect();
  }

  public disconnect() {
    if (this.wss) {
      this.wss.disconnect();
      this.wss = undefined;
      this.device = undefined;
    }
  }

  /** Connected transport for run/debug; undefined if offline. */
  public get transport(): DeviceTransport | undefined {
    return this.wss;
  }

  public getDeviceInfo() {
    if (this.wss) {
      return this.wss.deviceInfo;
    }
  }

  public get status() {
    if (this.wss) {
      if (this.wss.isRunning) {
        return Status.running;
      } else {
        return Status.online;
      }
    } else {
      return Status.offline;
    }
  }
}
