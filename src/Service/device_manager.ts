import * as vscode from "vscode";
import { DeviceService } from "./device_service";
import { DeviceIpItem } from "../ui/provider/device_data";
import { DeviceAddr } from "../model/device";
import { Status } from "../model/status";
import { Instance } from "../instance";

const IPREGEX =
  /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

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

  constructor(private context: vscode.ExtensionContext) {}

  public connectDeviceCommand(args: any) {
    let ip: string | undefined = undefined;
    if (!args) {
      // Ask user to input ip
      var selectItems: vscode.QuickPickItem[] = [];
      for (let _device of Instance.instance.discoveryService.getDevices()) {
        selectItems.push(new DeviceQuickPickItem(_device));
      }
      const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
      quickPick.title = "Connect to Device";
      quickPick.placeholder = "Input IP address";
      quickPick.items = selectItems;
      quickPick.canSelectMany = false;
      
      quickPick.onDidChangeValue((value) => {
        if (value && !quickPick.selectedItems.length) {
          // 检查用户输入是否为有效的 IP 地址格式
          if (IPREGEX.test(value.trim())) {
            quickPick.items = [
              ...selectItems,
              {
                label: value.trim(),
                description: "Custom IP address",
                iconPath: new vscode.ThemeIcon("globe")
              }
            ];
          } else if (value.trim()) {
            // 如果输入不为空且不符合 IP 格式，显示错误提示
            quickPick.items = [
              ...selectItems,
              {
                alwaysShow: true,
                picked: false,
                label: "Invalid IP format",
                description: "Please enter a valid IP address",
                iconPath: new vscode.ThemeIcon("warning")
              }
            ];
          } else {
            quickPick.items = selectItems;
          }
        }
      });
      
      quickPick.onDidChangeSelection((selection) => {
        if (selection[0]) {
          if (selection[0].label === "Invalid IP format") {
            return; // 不允许选择无效的 IP 格式项
          }
          quickPick.hide();
          if (selection[0] instanceof DeviceQuickPickItem) {
            this.addDevice(selection[0].device);
          } else {
            // 处理自定义输入的 IP 地址
            const customIp = selection[0].label;
            if (IPREGEX.test(customIp)) {
              let deviceList = Instance.instance.discoveryService.getDevices();
              let deviceAddr = deviceList.find((device) => device.ip === customIp);
              if (deviceAddr) {
                this.addDevice(deviceAddr);
              } else {
                this.addDevice({ name: "Unknown", ip: customIp });
              }
            } else {
              vscode.window.showErrorMessage("Invalid IP address: " + customIp);
            }
          }
        }
      });
      
      quickPick.onDidAccept(() => {
        const value = quickPick.value.trim();
        if (value && !quickPick.selectedItems.length) {
          if (IPREGEX.test(value)) {
            quickPick.hide();
            let deviceList = Instance.instance.discoveryService.getDevices();
            let deviceAddr = deviceList.find((device) => device.ip === value);
            if (deviceAddr) {
              this.addDevice(deviceAddr);
            } else {
              this.addDevice({ name: "Unknown", ip: value });
            }
          } else {
            vscode.window.showErrorMessage("Invalid IP address format: " + value);
          }
        }
      });
      
      quickPick.show();
    } else if (typeof args === "string") {
      // ip = args;
      if (IPREGEX.test(args)) {
        ip = args;
      } else {
        vscode.window.showErrorMessage("Invalid IP address: " + args);
        return;
      }
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

  public disconnectDeviceCommand() {}

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
