import * as vscode from "vscode";
import { ImageViewer } from "./ui/provider/image_viewer";
import { Instance } from "./instance";
import { Commands, DebugTypeName } from "./constants";
import { error, formatUnknown, log, showLog } from "./logger";
import { resolveSourceForRun } from "./debugger/source_resolve";

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
      name: Commands.refreshExampleSource,
      func: (item?: { sourceId?: string }) => {
        const id = item?.sourceId;
        if (!id) {
          vscode.window.showErrorMessage("No example source selected");
          return;
        }
        void Instance.instance.exampleFileProvider.refreshSource(id);
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
      name: Commands.openExampleSource,
      func: (item?: {
        fsPath?: string;
        resourceUri?: vscode.Uri;
        sourceId?: string;
      }) => {
        const uri =
          item?.resourceUri ??
          (item?.fsPath ? vscode.Uri.file(item.fsPath) : undefined);
        if (!uri) {
          vscode.window.showErrorMessage("No example file selected");
          return;
        }
        void Instance.instance.exampleFileProvider.openFile(
          uri,
          true,
          item?.sourceId
        );
      },
    },
    {
      name: Commands.openImageViewer,
      func: () => {
        Instance.instance.imageViewer.showWindow();
      },
    },
    {
      name: Commands.runOnDevice,
      func: async () => {
        showLog();
        log("[Command] runOnDevice");
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("No active editor");
          log("[Command] runOnDevice: no active editor");
          return;
        }
        // Save only real files; example:/untitled cannot save to disk the same way
        if (
          editor.document.isDirty &&
          editor.document.uri.scheme === "file"
        ) {
          await editor.document.save();
        }
        let program: string;
        try {
          const resolved = resolveSourceForRun();
          program = resolved.fsPath || resolved.label;
          log(
            `[Command] runOnDevice resolved label=${resolved.label} fsPath=${resolved.fsPath ?? "n/a"}`
          );
        } catch (e) {
          error(`[Command] resolve source failed: ${formatUnknown(e)}`, true);
          return;
        }
        const connected = Instance.instance.deviceManager.getConnectedDevice();
        log(`[Command] runOnDevice program=${program} connected=${connected.length}`);
        if (connected.length === 0) {
          vscode.window.showErrorMessage(
            "No device connected. Connect a MaixCAM from the MaixCode sidebar first."
          );
          return;
        }
        try {
          const started = await vscode.debug.startDebugging(undefined, {
            type: DebugTypeName,
            request: "launch",
            name: "MaixPy: Run Current File on Device",
            program,
          });
          log(`[Command] runOnDevice startDebugging returned ${started}`);
          if (!started) {
            error("vscode.debug.startDebugging returned false", true);
          }
        } catch (e) {
          error(`[Command] runOnDevice failed: ${formatUnknown(e)}`, true);
        }
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
