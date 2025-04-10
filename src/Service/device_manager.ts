import * as vscode from "vscode";
import { DeviceService } from "./device_service";
import { DeviceIpItem } from "../ui/provider/device_data";
import { DeviceAddr } from "../model/device";
import { Status } from "../model/status";
import { Instance } from "../instance";

export class DeviceQuickPickItem implements vscode.QuickPickItem {
  label: string;
  description?: string | undefined;

  iconPath = new vscode.ThemeIcon("vm");

  constructor(public device: DeviceAddr) {
    this.label = device.name;
    this.description = device.ip;
  }
}

export class DeviceManager {
  private deviceList: DeviceService[] = [];

  private currentDevice: DeviceService | undefined;

  constructor(private context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        "maixcode.deviceConnect",
        async (args) => {
          let ip: string | undefined = undefined;
          if (!args) {
            // Ask user to input ip
            var selectItems = [];
            for (let _device of Instance.instance.discoveryService.getDevices()) {
              selectItems.push(new DeviceQuickPickItem(_device));
            }
            const quickPick =
              vscode.window.createQuickPick<DeviceQuickPickItem>();
            quickPick.title = "Connect to Device";
            quickPick.placeholder = "Input IP address";
            quickPick.items = selectItems;
            quickPick.onDidChangeSelection((selection) => {
              if (selection[0]) {
                quickPick.hide();
                this.addDevice(selection[0].device);
              }
            });
            quickPick.show();
          } else if (typeof args === "string") {
            ip = args;
          } else if (args instanceof DeviceIpItem) {
            ip = args.ip;
          }
          if (ip) {
            let deviceList = Instance.instance.discoveryService.getDevices();
            let deviceAddr = deviceList.find((device) => device.ip === ip);
            if (deviceAddr) {
              this.addDevice(deviceAddr);
            } else {
              this.addDevice({ name: "Unknown", ip: ip });
            }
          }
        }
      ),
      vscode.commands.registerCommand("maixcode.deviceDisconnect", () => {
        // this.disconnect();
      })
    );
  }

  public addDevice(device: DeviceAddr) {
    let deviceService = new DeviceService(this.context, device);
    this.deviceList.push(deviceService);
    if (this.currentDevice === undefined) {
      this.currentDevice = deviceService;
    }
    deviceService.connect();
  }

  public getDeviceList() {
    return this.deviceList;
  }

  public getConnectedDevice() {
    return this.deviceList.filter(
      (device) =>
        device.device !== undefined &&
        device.wss !== undefined &&
        device.wss.isConnected
    );
  }

  public getCurrentDevice() {
    return this.currentDevice;
  }

  public setCurrentDevice(device: DeviceService) {
    if (!this.deviceList.includes(device)) {
      this.deviceList.push(device);
    }
    this.currentDevice = device;
  }

  public getStatus() {
    if (this.getConnectedDevice().length > 0) {
      return Status.online;
    } else {
      return Status.offline;
    }
  }
}
