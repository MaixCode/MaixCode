import * as vscode from "vscode";
import { WebSocketService } from "./websocket_service";
import { info, warn, error } from "../logger";
import { DeviceIpItem } from "../ui/provider/device_data";
import { Device } from "../model/device";
import { Instance } from "../instance";
import { Status } from "../model/status";

export class DeviceService {
  constructor(
    private context: vscode.ExtensionContext,
    public device?: Device,
    public wss?: WebSocketService,
    public onImage?: (imageData: ArrayBuffer) => void
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "maixcode.deviceConnect",
        async (args) => {
          let ip: string | undefined = undefined;
          if (!args) {
            // Ask user to input ip
            ip = await vscode.window.showInputBox({
              placeHolder: "Input device ip",
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
      ),
      vscode.commands.registerCommand("maixcode.deviceDisconnect", () => {
        this.disconnect();
      })
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
    this.wss.hookImg = (data: ArrayBuffer) => {
      this.onImage && this.onImage(data);
    };
    this.wss.connect();
    Instance.instance.setStatus(Status.online);
    Instance.instance.siderbar.refresh();
  }

  public disconnect() {
    if (this.wss) {
      this.wss.disconnect();
      this.wss = undefined;
      this.device = undefined;
      Instance.instance.setStatus(Status.offline);
      Instance.instance.siderbar.refresh();
    }
  }

  public getDeviceInfo() {
    if (this.wss) {
      return this.wss.deviceInfo;
    }
  }
}
