import * as vscode from "vscode";
import { ImageViewer } from "./ui/provider/image_viewer";
import { Instance } from "./instance";
import { Commands } from "./constants";

export function initCommands(context: vscode.ExtensionContext) {
  const commandList = [
    {
      name: Commands.connectDevice,
      func: (args: any) => {
        Instance.instance.deviceManager.connectDeviceCommand(args);
      },
    },
    {
      name: Commands.disconnectDevice,
      func: () => {
        Instance.instance.deviceManager.disconnectDeviceCommand();
      },
    },
    {
      name: Commands.discoverDevice,
      func: () => {
        Instance.instance.discoveryService.discover();
      },
    },
    {
      name: Commands.refreshDeviceData,
      func: () => {
        Instance.instance.sidebar.refresh();
      },
    },
    {
      name: Commands.refreshExample,
      func: () => {
        Instance.instance.exampleFileProvider.refresh();
      },
    },
    {
      name: Commands.openExample,
      func: (arg: any) => {
        if (arg instanceof vscode.Uri) {
          Instance.instance.exampleFileProvider.openFile(arg);
        } else {
          vscode.window.showErrorMessage("Invalid file URI");
          // TODO: Select file by user
        }
      },
    },
    {
      name: Commands.openImageViewer,
      func: () => {
        Instance.instance.imageViewer.showWindow();
      },
    },
    // {
    //   name: Commands.refreshDeviceData,
    //   func: () => {},
    // },
  ];
  for (let command of commandList) {
    const disposable = vscode.commands.registerCommand(
      command.name,
      command.func
    );
    context.subscriptions.push(disposable);
  }
}
