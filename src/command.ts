import * as vscode from "vscode";

export function initCommands(
  context: vscode.ExtensionContext,
  commandList: {
    name: string;
    func: () => void;
  }[]
) {
  commandList.forEach((command) => {
    const disposable = vscode.commands.registerCommand(
      command.name,
      command.func
    );
    context.subscriptions.push(disposable);
  });
}
