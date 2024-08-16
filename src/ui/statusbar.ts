import * as vscode from "vscode";

export class StatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right
    );
    this.statusBarItem.text = "MaixCode";
    this.statusBarItem.command = "maixcode.helloWorld";
    this.statusBarItem.show();
  }

  public update(text: string) {
    this.statusBarItem.text = `MaixCode: ${text}`;
  }

  public dispose() {
    this.statusBarItem.dispose();
  }
}
