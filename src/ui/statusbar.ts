import * as vscode from "vscode";
import { Status } from "../model/status";
import { Instance } from "../instance";

export class StatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right
    );
    this.statusBarItem.text = "MaixCode";
    // this.statusBarItem.command = "maixcode.helloWorld";
    this.statusBarItem.show();
  }

  public updateByStatus(status: Status) {
    switch (status) {
      case Status.online:
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground"
        );
        this.statusBarItem.text =
          Instance.instance.deviceManager.getConnectedDevice()
            ? "MaixCode: Online"
            : "MaixCode: Offline";
        break;
      case Status.offline:
        this.statusBarItem.text = "MaixCode: Offline";
        break;
      case Status.connecting:
        this.statusBarItem.text = "MaixCode: Connecting";
        break;
      case Status.error:
        this.statusBarItem.text = "MaixCode: Error";
        break;
    }
  }

  public update(text: string) {
    this.statusBarItem.text = `MaixCode: ${text}`;
  }

  public dispose() {
    this.statusBarItem.dispose();
  }
}
