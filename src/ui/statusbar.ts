import * as vscode from "vscode";
import { Status } from "../model/status";
import { Instance } from "../instance";
import { Commands } from "../constants";

export class StatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = "MaixCode";
    this.statusBarItem.command = Commands.connectDevice;
    this.applyStatus(Status.offline);
    this.statusBarItem.show();
  }

  public updateByStatus(status: Status) {
    this.applyStatus(status);
  }

  private applyStatus(status: Status) {
    const device = this.primaryDeviceLabel();
    switch (status) {
      case Status.running: {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground"
        );
        this.statusBarItem.color = undefined;
        this.statusBarItem.text = device
          ? `$(play) MaixCode: Running · ${device}`
          : "$(play) MaixCode: Running";
        this.statusBarItem.tooltip = "Program is running on the device";
        this.statusBarItem.command = Commands.runOnDevice;
        break;
      }
      case Status.online: {
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = undefined;
        this.statusBarItem.text = device
          ? `$(vm-active) MaixCode: Online · ${device}`
          : "$(vm-active) MaixCode: Online";
        this.statusBarItem.tooltip = "Device connected — click to connect another";
        this.statusBarItem.command = Commands.connectDevice;
        break;
      }
      case Status.connecting: {
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.text = device
          ? `$(sync~spin) MaixCode: Connecting · ${device}`
          : "$(sync~spin) MaixCode: Connecting";
        this.statusBarItem.tooltip = "Connecting to device…";
        this.statusBarItem.command = Commands.connectDevice;
        break;
      }
      case Status.error: {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground"
        );
        this.statusBarItem.text = "$(error) MaixCode: Error";
        this.statusBarItem.tooltip = "MaixCode error";
        this.statusBarItem.command = Commands.connectDevice;
        break;
      }
      case Status.offline:
      default: {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground"
        );
        this.statusBarItem.text = "$(vm-outline) MaixCode: Offline";
        this.statusBarItem.tooltip = "No device connected — click to connect";
        this.statusBarItem.command = Commands.connectDevice;
        break;
      }
    }
  }

  private primaryDeviceLabel(): string | undefined {
    try {
      const manager = Instance.instance?.deviceManager;
      if (!manager) {
        return undefined;
      }
      const current = manager.getCurrentDevice();
      const connected = manager.getConnectedDevice();
      const preferred =
        current && connected.includes(current) ? current : connected[0];
      if (!preferred?.device) {
        return undefined;
      }
      const { name, ip } = preferred.device;
      if (name && name !== "Unknown") {
        return name;
      }
      return ip;
    } catch {
      return undefined;
    }
  }

  public update(text: string) {
    this.statusBarItem.text = `MaixCode: ${text}`;
  }

  public dispose() {
    this.statusBarItem.dispose();
  }
}
