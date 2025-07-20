import * as vscode from "vscode";
import { DeviceDataProvider, DeviceIpItem } from "./provider/device_data";
import { Commands } from "../constants";

export class Sidebar {
  private deviceDataProvider: DeviceDataProvider;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.deviceDataProvider = new DeviceDataProvider();
    vscode.window.registerTreeDataProvider(
      "maixcode-devices",
      this.deviceDataProvider
    );
    // context.subscriptions.push(
    //   vscode.commands.registerCommand(Commands.refreshDeviceData, () => {
    //     this.deviceDataProvider.refresh();
    //   })
    // );
    // setInterval(() => {
    //   this.deviceDataProvider.refresh();
    // }, 2000);
  }

  public refresh() {
    this.deviceDataProvider.refresh();
  }
}
