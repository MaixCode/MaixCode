import * as vscode from "vscode";
import { TreeItem } from "vscode";
import { Device } from "../Model/device";

export class Sidebar {
  private deviceDataProvider: DeviceDataProvider;
  constructor(
    private readonly context: vscode.ExtensionContext,
    public getDevices: () => { name: string; ip: string }[] = () => []
  ) {
    this.deviceDataProvider = new DeviceDataProvider(getDevices);
    vscode.window.registerTreeDataProvider(
      "maixcode-devices",
      this.deviceDataProvider
    );
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.refreshDevices", () => {
        this.deviceDataProvider.refresh();
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.deviceConnect", (args) => {
        args;
        if (args instanceof DeviceIpItem) {
          vscode.window.showInformationMessage(`Connect to ${args.label}`);
        }
      })
    );
    setInterval(() => {
      this.deviceDataProvider.refresh();
    }, 2000);
  }

  public refresh() {
    this.deviceDataProvider.refresh();
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
    for (let name of names) {
      items.push(new DeviceGroupItem(name));
    }
    items.unshift(new DeviceInfoItem(`Total ${devices.length} devices`));
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
