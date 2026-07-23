import * as vscode from "vscode";
import { Status } from "../model/status";
import { Instance } from "../instance";
import { Commands } from "../constants";

export class StatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private runFileItem: vscode.StatusBarItem;
  private runProjectItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.name = "MaixCode";
    this.statusBarItem.command = Commands.connectDevice;
    this.applyStatus(Status.offline);
    this.statusBarItem.show();

    // Run actions sit to the right of device status (lower priority = further right on Left)
    this.runFileItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.runFileItem.name = "MaixCode Run File";
    this.runFileItem.text = "$(play) Run File";
    this.runFileItem.tooltip = "Run current Python file on MaixCAM";
    this.runFileItem.command = Commands.runOnDevice;
    this.runFileItem.show();

    this.runProjectItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98
    );
    this.runProjectItem.name = "MaixCode Run Project";
    this.runProjectItem.text = "$(run-all) Run Project";
    this.runProjectItem.tooltip =
      "Package workspace project and run on MaixCAM (RunProject)";
    this.runProjectItem.command = Commands.runProject;
    this.runProjectItem.show();

    this.updateRunButtons(Status.offline);
  }

  public updateByStatus(status: Status) {
    this.applyStatus(status);
    this.updateRunButtons(status);
  }

  private updateRunButtons(status: Status) {
    const online =
      status === Status.online ||
      status === Status.running ||
      status === Status.connecting;
    if (online) {
      this.runFileItem.backgroundColor = undefined;
      this.runProjectItem.backgroundColor = undefined;
      this.runFileItem.tooltip = "Run current Python file on MaixCAM";
      this.runProjectItem.tooltip =
        "Package workspace project and run on MaixCAM (RunProject)";
    } else {
      this.runFileItem.tooltip =
        "Run current file (connect a MaixCAM first)";
      this.runProjectItem.tooltip =
        "Run project (connect a MaixCAM first)";
    }
    if (status === Status.running) {
      this.runFileItem.text = "$(debug-restart) Re-run File";
      this.runProjectItem.text = "$(debug-restart) Re-run Project";
    } else {
      this.runFileItem.text = "$(play) Run File";
      this.runProjectItem.text = "$(run-all) Run Project";
    }
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
        this.statusBarItem.tooltip =
          "Program is running on the device — click to re-run file";
        this.statusBarItem.command = Commands.runOnDevice;
        break;
      }
      case Status.online: {
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = undefined;
        this.statusBarItem.text = device
          ? `$(vm-active) MaixCode: Online · ${device}`
          : "$(vm-active) MaixCode: Online";
        this.statusBarItem.tooltip =
          "Device connected — click to connect another";
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
    this.runFileItem.dispose();
    this.runProjectItem.dispose();
  }
}
