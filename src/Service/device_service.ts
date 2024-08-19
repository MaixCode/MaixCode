import * as vscode from "vscode";
import { WebSocketService } from "./websocket_service";
import { info, warn, error } from "../logger";
import { DeviceStatus } from "../model/device_status";
import { DeviceIpItem } from "../ui/provider/device_data";
import { Device } from "../model/device";

export class DeviceService {
  constructor(
    private context: vscode.ExtensionContext,
    public device?: Device,
    public wss?: WebSocketService
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "maixcode.deviceConnect",
        async (args) => {
          let ip: string | undefined = undefined;
          if (!args) {
            // Ask user to input ip
            ip = await vscode.window.showInputBox({
              prompt: "Input device ip",
              validateInput: (value) => {
                // Validate IP address format
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (!ipRegex.test(value)) {
                  return "Invalid IP address format";
                }
                return null;
              },
            });
          } else if (typeof args === "string") {
            ip = args;
          } else if (args instanceof DeviceIpItem) {
            ip = args.ip;
          }
          if (ip) {
            this.connect(new Device("unknown", ip));
          }
        }
      )
    );
  }

  public connect(device?: Device) {
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
    this.wss.hookClose = (code, reason) => {
      info(`Device ${this.device?.name} disconnected: ${reason}`);
      this.wss = undefined;
    };
    this.wss.connect();
  }

  public disconnect() {
    if (this.wss) {
      this.wss.disconnect();
      this.wss = undefined;
    }
  }

  public getDeviceInfo() {
    if (this.wss) {
      return this.wss.deviceInfo;
    }
  }
}
