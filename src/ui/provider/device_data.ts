import * as vscode from "vscode";
import { TreeItem } from "vscode";
import { Instance } from "../../instance";
import { Status } from "../../model/status";
import { Commands } from "../../constants";

enum DeviceType {
  localDevice = "Local Device",
}

export class DeviceDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    TreeItem | undefined | void
  > = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private getDevices: () => { name: string; ip: string }[];
  constructor() {
    this.getDevices = () => Instance.instance.discoveryService.getDevices();
  }

  public refresh() {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(element: TreeItem) {
    return element;
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    if (!element) {
      return Promise.resolve(this.getRootItem());
    }
    if (element instanceof DeviceTypeItem) {
      if (element.type === DeviceType.localDevice) {
        if (!this.getDevices().length) {
          return Promise.resolve([new DeviceBlankItem()]);
        }
        return Promise.resolve(
          Array.from(
            new Set(this.getDevices().map((device) => device.name))
          ).map((name) => new DeviceGroupItem(name))
        );
      }
    } else if (element instanceof DeviceGroupItem) {
      return Promise.resolve(this.getIpItems(element.name));
    } else if (element instanceof DeviceInfoGroupItem) {
      return Promise.resolve([
        ...this.getInfoItems(),
        ...this.getDeviceActionItems(),
        new DeviceDisconnectItem(),
      ]);
    }
    return Promise.resolve([]);
  }

  private getRootItem() {
    let status = Instance.instance.getStatus();
    if (status === Status.offline) {
      return [
        new DeviceTypeItem(DeviceType.localDevice),
        new DeviceManualConnectItem(),
      ];
    } else {
      return [
        new DeviceTypeItem(DeviceType.localDevice),
        new DeviceInfoGroupItem(),
      ];
    }
  }

  private getIpItems(name: string) {
    let devices = this.getDevices().filter((device) => device.name === name);
    return devices.map((device) => new DeviceIpItem(device.ip, device.name));
  }

  private getInfoItems() {
    let deviceList = Instance.instance.deviceManager.getConnectedDevice();
    if (!deviceList) {
      return [];
    }
    for (let device of deviceList) {
      let info = device.getDeviceInfo();
      if (info) {
        return [
          new DeviceInfoItem(`Name: ${device.device?.name}`),
          new DeviceInfoItem(`IP: ${device.device?.ip}`),
          new DeviceInfoItem(`SysVer: ${info.sysVer}`),
          new DeviceInfoItem(`MaixPyVer: ${info.maixpyVer}`),
          new DeviceInfoItem(
            `Device: ${info.device || "Unknown"}`
          ),
          new DeviceInfoItem(
            `Runtime: ${info.runtime || "not installed"}`
          ),
          new DeviceInfoItem(`ApiKey: ${info.apiKey}`),
        ];
      }
    }
    return [];
  }

  private getDeviceActionItems(): TreeItem[] {
    const deviceList = Instance.instance.deviceManager.getConnectedDevice();
    for (const device of deviceList) {
      const ip = device.device?.ip;
      if (ip) {
        const name = device.device?.name || "";
        return [
          new DeviceActionItem(
            "Run Current File",
            Commands.runOnDevice,
            "play",
            "maixcode-deviceRunFile"
          ),
          new DeviceActionItem(
            "Run Project",
            Commands.runProject,
            "run-all",
            "maixcode-deviceRunProject"
          ),
          new DeviceActionItem(
            "Package App",
            Commands.packageApp,
            "package",
            "maixcode-devicePackageApp"
          ),
          new DeviceActionItem(
            "Install App",
            Commands.installApp,
            "cloud-upload",
            "maixcode-deviceInstallApp"
          ),
          new DeviceActionItem(
            "Configure Project",
            Commands.configureProject,
            "settings-gear",
            "maixcode-deviceConfigureProject"
          ),
          new DeviceActionItem(
            "Install Runtime",
            Commands.installRuntime,
            "cloud-download",
            "maixcode-deviceInstallRuntime"
          ),
          new DeviceOpenTerminalItem(ip, name),
          new DeviceOpenSftpItem(ip, name),
        ];
      }
    }
    return [];
  }
}

export class DeviceGroupItem extends TreeItem {
  constructor(public name: string) {
    super(name);
  }

  collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  contextValue = "maixcode-deviceGroup";
}

export class DeviceTypeItem extends TreeItem {
  constructor(public type: DeviceType) {
    super(type);
  }

  collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  contextValue = "maixcode-deviceType";
}

export class DeviceIpItem extends TreeItem {
  constructor(public ip: string, public name: string) {
    super(ip);
  }

  contextValue = "maixcode-deviceIp";
  iconPath = new vscode.ThemeIcon("vm");
}

export class DeviceInfoGroupItem extends TreeItem {
  constructor() {
    super("Current Device Info");
  }

  collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  contextValue = "maixcode-deviceInfoGroup";
}

export class DeviceInfoItem extends TreeItem {
  constructor(public info: string) {
    super(info);
  }

  contextValue = "maixcode-deviceInfo";
  iconPath = new vscode.ThemeIcon("info");
}

export class DeviceManualConnectItem extends TreeItem {
  constructor() {
    super("Manual Connect");
  }

  contextValue = "maixcode-deviceManualConnect";

  iconPath = new vscode.ThemeIcon("debug-disconnect");

  command = {
    command: Commands.connectDevice,
    title: "Connect",
  };
}


export class DeviceActionItem extends TreeItem {
  constructor(
    label: string,
    commandId: string,
    icon: string,
    contextValue: string
  ) {
    super(label);
    this.contextValue = contextValue;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = {
      command: commandId,
      title: label,
    };
  }
}

export class DeviceOpenTerminalItem extends TreeItem {
  constructor(public ip: string, public name: string) {
    super("Open SSH Terminal");
    this.command = {
      command: Commands.openDeviceTerminal,
      title: "Open SSH Terminal",
      arguments: [{ ip, name }],
    };
  }

  contextValue = "maixcode-deviceOpenTerminal";

  iconPath = new vscode.ThemeIcon("terminal");
}

export class DeviceOpenSftpItem extends TreeItem {
  constructor(public ip: string, public name: string) {
    super("Open Device Files (SFTP)");
    this.command = {
      command: Commands.openDeviceSftp,
      title: "Open Device Files (SFTP)",
      arguments: [{ ip, name }],
    };
  }

  contextValue = "maixcode-deviceOpenSftp";

  iconPath = new vscode.ThemeIcon("folder-opened");
}

export class DeviceDisconnectItem extends TreeItem {
  constructor() {
    super("Disconnect");
  }

  contextValue = "maixcode-deviceDisconnect";

  iconPath = new vscode.ThemeIcon("debug-disconnect");

  command = {
    command: Commands.disconnectDevice,
    title: "Disconnect",
  };
}

export class DeviceBlankItem extends TreeItem {
  constructor() {
    super("No device found");
  }
}
