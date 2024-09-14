import * as vscode from "vscode";
import { TreeItem } from "vscode";
import { Instance } from "../../instance";
import { Status } from "../../model/status";

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

  refresh(): void {
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
        return Promise.resolve(
          Array.from(
            new Set(this.getDevices().map((device) => device.name))
          ).map((name) => new DeviceGroupItem(name))
        );
      }
    } else if (element instanceof DeviceGroupItem) {
      return Promise.resolve(this.getIpItems(element.name));
    } else if (element instanceof DeviceInfoGroupItem) {
      return Promise.resolve(this.getInfoItems());
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
      return [new DeviceInfoGroupItem()];
    }
  }

  private getIpItems(name: string) {
    let devices = this.getDevices().filter((device) => device.name === name);
    return devices.map((device) => new DeviceIpItem(device.ip));
  }

  private getInfoItems() {
    let device = Instance.instance.deviceService.device;
    let data = Instance.instance.deviceService.getDeviceInfo();
    if (data === undefined || data.length === 0) {
      return [new DeviceInfoItem("No device info")];
    }
    // decode data json
    let info = JSON.parse(data);
    if (!device) {
      return [new DeviceInfoItem("No device info")];
    }
    let infoItems = [];
    for (let key in info) {
      infoItems.push(new DeviceInfoItem(`${key}: ${info[key]}`));
    }
    return [
      new DeviceInfoItem(`Name: ${device.name}`),
      new DeviceInfoItem(`IP: ${device.ip}`),
      ...infoItems,
      new DeviceDisconnectItem(),
    ];
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
  constructor(public ip: string) {
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
  // iconPath = new vscode.ThemeIcon("info");
}

export class DeviceManualConnectItem extends TreeItem {
  constructor() {
    super("Manual Connect");
  }

  contextValue = "maixcode-deviceManualConnect";

  iconPath = new vscode.ThemeIcon("debug-disconnect");

  command = {
    command: "maixcode.deviceConnect",
    title: "Connect",
  };
}

export class DeviceDisconnectItem extends TreeItem {
  constructor() {
    super("Disconnect");
  }

  contextValue = "maixcode-deviceDisconnect";

  iconPath = new vscode.ThemeIcon("debug-disconnect");

  command = {
    command: "maixcode.deviceDisconnect",
    title: "Disconnect",
  };
}
