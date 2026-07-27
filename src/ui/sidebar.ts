import * as vscode from "vscode";
import { DeviceDataProvider, DeviceIpItem } from "./provider/device_data";
import { Commands } from "../constants";
import { log } from "../logger";

export class Sidebar {
  private deviceDataProvider: DeviceDataProvider;
  constructor(private readonly context: vscode.ExtensionContext) {
    log("[Sidebar] constructor");
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
    log("[Sidebar] refresh");
    this.deviceDataProvider.refresh();
  }
}
