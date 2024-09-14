import * as vscode from "vscode";
import { DeviceDataProvider, DeviceIpItem } from "./provider/device_data";

export class Sidebar {
  private deviceDataProvider: DeviceDataProvider;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.deviceDataProvider = new DeviceDataProvider();
    vscode.window.registerTreeDataProvider(
      "maixcode-devices",
      this.deviceDataProvider
    );
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.refreshDevices", () => {
        this.deviceDataProvider.refresh();
      })
    );
    // setInterval(() => {
    //   this.deviceDataProvider.refresh();
    // }, 2000);
  }

  public refresh() {
    this.deviceDataProvider.refresh();
  }
}
