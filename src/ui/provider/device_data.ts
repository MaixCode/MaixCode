import * as vscode from "vscode";
import { TreeItem } from "vscode";

enum DeviceType {
  localDevice = "Local Device",
}

export class DeviceDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    TreeItem | undefined | void
  > = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor(
    public getDevices: () => { name: string; ip: string }[] = () => []
  ) {}

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
    }
    return Promise.resolve([]);
  }

  private getRootItem() {
    return [
      new DeviceTypeItem(DeviceType.localDevice),
      new DeviceManualConnectItem(),
    ];
  }

  private getIpItems(name: string) {
    let devices = this.getDevices().filter((device) => device.name === name);
    return devices.map((device) => new DeviceIpItem(device.ip));
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
