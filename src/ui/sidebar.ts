import * as vscode from "vscode";
import { TreeItem } from "vscode";

export class Sidebar {
  constructor(
    private readonly context: vscode.ExtensionContext,
    public getDevices: () => { name: string; ip: string }[] = () => []
  ) {
    let deviceDataProvider = new DeviceDataProvider(getDevices);
    vscode.window.registerTreeDataProvider(
      "maixcode-devices",
      deviceDataProvider
    );
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.refreshDevices", () => {
        deviceDataProvider.refresh();
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.deviceConnect", (args) => {
        // args;4
        // if (args instanceof DeviceItem) {
        //   vscode.window.showInformationMessage(`Connect to ${args.label}`);
        // }
      })
    );
    setInterval(() => {
      deviceDataProvider.refresh();
    }, 2000);
  }
}

class DeviceDataProvider implements vscode.TreeDataProvider<TreeItem> {
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
    if (element instanceof DeviceGroupItem) {
      return Promise.resolve(this.getIpItems(element.name));
    }
    return Promise.resolve([]);
  }

  private getRootItem() {
    let devices = this.getDevices();
    let items: TreeItem[] = [];
    let names = new Set(devices.map((device) => device.name));
    names.forEach((name) => {
      items.push(new DeviceGroupItem(name));
    });
    return items;
  }

  private getIpItems(name: string) {
    let devices = this.getDevices().filter((device) => device.name === name);
    return devices.map((device) => new DeviceIpItem(device.ip));
  }
}

class DeviceGroupItem extends TreeItem {
  constructor(public name: string) {
    super(name);
  }

  collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  contextValue = "maixcode-deviceGroup";
}

class DeviceIpItem extends TreeItem {
  constructor(public ip: string) {
    super(ip);
  }

  contextValue = "maixcode-deviceIp";
  iconPath = new vscode.ThemeIcon("vm");
}

class DeviceInfoItem extends TreeItem {
  constructor(public info: string) {
    super(info);
  }

  contextValue = "maixcode-deviceInfo";
  // iconPath = new vscode.ThemeIcon("info");
}
