import * as vscode from "vscode";
import { WebSocketService } from "./websocket_service";
import { info, warn, error } from "../logger";
import { DeviceIpItem } from "../ui/provider/device_data";
import { DeviceAddr } from "../model/device";
import { Instance } from "../instance";
import { Status } from "../model/status";

export class DeviceService {
  private is_running = false;

  constructor(
    private context: vscode.ExtensionContext,
    public device?: DeviceAddr,
    public wss?: WebSocketService
  ) {}

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
    this.wss.on("close", (code, reason) => {
      info(`Device ${this.device?.name} disconnected: ${reason}`);
      this.wss = undefined;
    });
    this.wss.on("img", (data: ArrayBuffer) => {
      Instance.instance.imageService.setImage(
        this.device?.name || "Undefined",
        data
      );
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
