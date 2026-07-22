import * as vscode from "vscode";
import { DeviceService } from "./device_service";
import { DeviceIpItem } from "../ui/provider/device_data";
import { DeviceAddr } from "../model/device";
import { Status } from "../model/status";
import { error, info } from "../logger";
import {
  ConfigKeys,
  ConfigSection,
  defaultDeviceName,
  LastConnectedDeviceKey,
} from "../constants";

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

export type DeviceManagerDeps = {
  getDiscoveredDevices: () => DeviceAddr[];
  onFrame?: (deviceKey: string, data: ArrayBuffer) => void;
  /** UI refresh when connection set changes (sidebar etc.) */
  onConnectionListChanged?: () => void;
};

export class DeviceManager {
  private deviceList: DeviceService[] = [];

  private currentDevice: DeviceService | undefined;

  private getDiscoveredDevices: () => DeviceAddr[];
  private onFrame?: (deviceKey: string, data: ArrayBuffer) => void;
  private onConnectionListChanged?: () => void;

  /** After manual disconnect, skip auto-connect until user connects or setting changes */
  private suppressAutoConnect = false;
  /** IP currently being auto-connected (avoid duplicate attempts) */
  private autoConnectPendingIp: string | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    deps: DeviceManagerDeps
  ) {
    this.getDiscoveredDevices = deps.getDiscoveredDevices;
    this.onFrame = deps.onFrame;
    this.onConnectionListChanged = deps.onConnectionListChanged;
  }

  private notifyConnectionListChanged() {
    this.onConnectionListChanged?.();
  }

  public connectDeviceCommand(args: any) {
    this.suppressAutoConnect = false;
    let ip: string | undefined = undefined;
    let name: string | undefined = undefined;
    let deviceAddr: DeviceAddr | undefined = undefined;
    // 根据 deviceAddr or ip or name 来连接设备
    // let ip: string | undefined = undefined;
    if (!args) {
      // Ask user to input ip
      var selectItems: vscode.QuickPickItem[] = [];
      for (let _device of this.getDiscoveredDevices()) {
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
            deviceAddr = selection[0].device;
            this.connectDeviceCommand(deviceAddr);
          } else {
            // 处理自定义输入的 IP 地址
            const customIp = selection[0].label;
            if (IPREGEX.test(customIp)) {
              ip = customIp;
              this.connectDeviceCommand(ip);
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
            ip = value;
            this.connectDeviceCommand(ip);
          } else {
            vscode.window.showErrorMessage("Invalid IP address format: " + value);
          }
        }
      });
      
      quickPick.show();
      return;
    } else if (args instanceof DeviceAddr) {
      deviceAddr = args;
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
      name = args.name;
    }

    // 尽可能地从已发现的设备中获取 deviceAddr
    if (deviceAddr) {
      // 若先指定 deviceAddr，则直接连接
      if (this.isConnected(deviceAddr)) {
        info(`Device ${deviceAddr.name} is already connected.`);
        vscode.window.showInformationMessage(
          `Device ${deviceAddr.name} is already connected.`
        );
        return;
      }
      this.addDevice(deviceAddr);
      return;
    } else if (ip && name !== undefined && name !== defaultDeviceName) {
      // 若指定 ip & name
      let deviceList = this.getDiscoveredDevices();
      deviceAddr = deviceList.find((device) => device.ip === ip && device.name === name);
      if (!deviceAddr) {
        // 若未找到，则创建新的 DeviceAddr
        deviceAddr = new DeviceAddr(name, ip);
      }
    } else if (ip) {
      // 若只指定 ip
      if (!IPREGEX.test(ip)) {
        error(`Invalid IP address: ${ip}`);
        vscode.window.showErrorMessage("Invalid IP address: " + ip);
        return;
      }
      let deviceList = this.getDiscoveredDevices();
      deviceAddr = deviceList.find((device) => device.ip === ip && device.name === name);
    } else {
      // ip, name, deviceAddr 都未指定
      error("No device address or IP specified.");
      return;
    }

    if (deviceAddr) {
      // 找到设备在设备列表中
      if (this.isConnected(deviceAddr)) {
        info(`Device ${deviceAddr.name} is already connected.`);
        vscode.window.showInformationMessage(
          `Device ${deviceAddr.name} is already connected.`
        );
        return;
      }
      this.addDevice(deviceAddr);
    } else {
      // 未找到设备，创建新的 DeviceAddr
      if (!ip || !IPREGEX.test(ip)) {
        error(`Invalid IP address: ${ip}`);
        vscode.window.showErrorMessage("Invalid IP address: " + ip);
        return;
      }
      deviceAddr = new DeviceAddr(defaultDeviceName, ip);
      if (this.isConnected(deviceAddr)) {
        info(`Device ${deviceAddr.name} is already connected.`);
        vscode.window.showInformationMessage(
          `Device ${deviceAddr.name} is already connected.`
        );
        return;
      }
      this.addDevice(deviceAddr);
    }
  }

  public disconnectDeviceCommand() {
    if (this.currentDevice) {
      this.suppressAutoConnect = true;
      this.autoConnectPendingIp = undefined;
      this.currentDevice.disconnect();
      this.deviceList = this.deviceList.filter(
        (deviceService) => deviceService !== this.currentDevice
      );
      this.currentDevice = undefined;
      this.notifyConnectionListChanged();
      vscode.window.showInformationMessage("Disconnected from device.");
    } else {
      vscode.window.showErrorMessage("No device is currently connected.");
    }
  }

  public addDevice(device: DeviceAddr) {
    let deviceService = new DeviceService(
      this.context,
      device,
      undefined,
      this.onFrame
    );
    deviceService.onConnectionStateChange = () => {
      const ip = deviceService.device?.ip;
      if (deviceService.wss?.isConnected && deviceService.device) {
        void this.context.globalState.update(LastConnectedDeviceKey, {
          name: deviceService.device.name,
          ip: deviceService.device.ip,
        });
        if (this.autoConnectPendingIp === ip) {
          this.autoConnectPendingIp = undefined;
        }
      } else if (!deviceService.wss) {
        // Drop closed sessions so auto-connect / reconnect can try again
        if (this.autoConnectPendingIp === ip) {
          this.autoConnectPendingIp = undefined;
        }
        this.deviceList = this.deviceList.filter((d) => d !== deviceService);
        if (this.currentDevice === deviceService) {
          this.currentDevice = this.deviceList[0];
        }
      }
      this.notifyConnectionListChanged();
    };
    this.deviceList.push(deviceService);
    if (this.currentDevice === undefined) {
      this.currentDevice = deviceService;
    }
    deviceService.connect();
    this.notifyConnectionListChanged();
  }

  public isConnected(device: DeviceAddr) {
    return this.deviceList.some(
      (deviceService) =>
        deviceService.wss !== undefined &&
        (deviceService.device?.ip === device.ip ||
          deviceService.device?.name === device.name)
    );
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

  /**
   * Connect a discovered device when auto-connect is enabled and nothing is online.
   * Target order: maixcode.autoConnectTarget → last connected → first discovered.
   */
  public tryAutoConnect(discovered: DeviceAddr[] = this.getDiscoveredDevices()) {
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    if (!cfg.get<boolean>(ConfigKeys.autoConnect, true)) {
      return;
    }
    if (this.suppressAutoConnect) {
      return;
    }
    if (discovered.length === 0) {
      return;
    }
    if (this.getConnectedDevice().length > 0) {
      return;
    }
    // Already opening a socket
    if (this.deviceList.some((d) => d.wss !== undefined)) {
      return;
    }

    const target = this.pickAutoConnectTarget(discovered, cfg);
    if (!target) {
      return;
    }
    if (this.isConnected(target)) {
      return;
    }
    if (this.autoConnectPendingIp === target.ip) {
      return;
    }

    this.autoConnectPendingIp = target.ip;
    info(`Auto-connect: ${target.name} (${target.ip})`);
    this.addDevice(target);
  }

  /** Clear suppress flag (e.g. user re-enabled auto-connect in settings) */
  public clearAutoConnectSuppress() {
    this.suppressAutoConnect = false;
  }

  private pickAutoConnectTarget(
    discovered: DeviceAddr[],
    cfg: vscode.WorkspaceConfiguration
  ): DeviceAddr | undefined {
    const preferred = (cfg.get<string>(ConfigKeys.autoConnectTarget, "") || "")
      .trim()
      .toLowerCase();

    if (preferred) {
      const byPref = discovered.find(
        (d) =>
          d.ip.toLowerCase() === preferred ||
          d.name.toLowerCase() === preferred ||
          d.name.toLowerCase().startsWith(preferred)
      );
      if (byPref) {
        return byPref;
      }
      // Preferred set but not on the network yet
      return undefined;
    }

    const last = this.context.globalState.get<{ name?: string; ip?: string }>(
      LastConnectedDeviceKey
    );
    if (last?.ip) {
      const byLast = discovered.find(
        (d) => d.ip === last.ip || (last.name && d.name === last.name)
      );
      if (byLast) {
        return byLast;
      }
    }

    return discovered[0];
  }
}
