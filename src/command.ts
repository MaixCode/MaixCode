import * as vscode from "vscode";
import { ImageViewer } from "./ui/provider/image_viewer";
import { Instance } from "./instance";
import { Commands, DebugTypeName } from "./constants";
import { error, formatUnknown, log, showLog } from "./logger";
import { resolveSourceForRun } from "./debugger/source_resolve";

export function initCommands(context: vscode.ExtensionContext) {
  const projectDirHint = (uri?: vscode.Uri): string | undefined => {
    if (uri?.scheme === "file") {
      return uri.fsPath;
    }
    return undefined;
  };

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
        void Instance.instance.imageViewer.showSidebar();
      },
    },
    {
      name: Commands.openImageViewerSidebar,
      func: () => {
        void Instance.instance.imageViewer.showSidebar();
      },
    },
    {
      name: Commands.openImageViewerPanel,
      func: () => {
        void Instance.instance.imageViewer.showWindow();
      },
    },
    {
      name: Commands.openDeviceTerminal,
      func: (args?: {
        ip?: string;
        host?: string;
        name?: string;
        deviceName?: string;
      }) => {
        let host = (args?.ip || args?.host || "").trim();
        let deviceName = args?.name || args?.deviceName;
        if (!host) {
          const connected =
            Instance.instance.deviceManager.getConnectedDevice();
          for (const d of connected) {
            const ip = d.device?.ip;
            if (ip) {
              host = ip;
              deviceName = deviceName || d.device?.name;
              break;
            }
          }
        }
        if (!host) {
          vscode.window.showErrorMessage(
            "No device IP. Select a device or connect first."
          );
          return;
        }
        void Instance.instance.sshTerminalService
          .open({ host, deviceName })
          .catch((e) => {
            error(
              `[Command] openDeviceTerminal: ${formatUnknown(e)}`,
              true
            );
          });
      },
    },
    {
      name: Commands.openDeviceSftp,
      func: (args?: {
        ip?: string;
        host?: string;
        name?: string;
        deviceName?: string;
      }) => {
        let host = (args?.ip || args?.host || "").trim();
        let deviceName = args?.name || args?.deviceName;
        if (!host) {
          const connected =
            Instance.instance.deviceManager.getConnectedDevice();
          for (const d of connected) {
            const ip = d.device?.ip;
            if (ip) {
              host = ip;
              deviceName = deviceName || d.device?.name;
              break;
            }
          }
        }
        if (!host) {
          vscode.window.showErrorMessage(
            "No device IP. Select a device or connect first."
          );
          return;
        }
        void Instance.instance.sftpService
          .open({ host, deviceName })
          .catch((e) => {
            error(`[Command] openDeviceSftp: ${formatUnknown(e)}`, true);
          });
      },
    },

    {
      name: Commands.sftpFilterPath,
      func: (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const list =
          uris && uris.length
            ? uris
            : uri
              ? [uri]
              : vscode.window.activeTextEditor?.document.uri
                ? [vscode.window.activeTextEditor.document.uri]
                : [];
        for (const u of list) {
          void Instance.instance.sftpService.filterUri(u).catch((e) => {
            error(`[Command] sftpFilterPath: ${formatUnknown(e)}`, true);
          });
        }
      },
    },
    {
      name: Commands.sftpUnfilterPath,
      func: (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const list =
          uris && uris.length
            ? uris
            : uri
              ? [uri]
              : [];
        for (const u of list) {
          void Instance.instance.sftpService.unfilterUri(u).catch((e) => {
            error(`[Command] sftpUnfilterPath: ${formatUnknown(e)}`, true);
          });
        }
      },
    },
    {
      name: Commands.sftpToggleShowFiltered,
      func: () => {
        void Instance.instance.sftpService.toggleShowFiltered().catch((e) => {
          error(`[Command] sftpToggleShowFiltered: ${formatUnknown(e)}`, true);
        });
      },
    },
    {
      name: Commands.sftpEditFilterPatterns,
      func: () => {
        void Instance.instance.sftpService.editFilterPatterns();
      },
    },
    {
      name: Commands.sftpRefresh,
      func: (uri?: vscode.Uri) => {
        const target =
          uri ??
          vscode.window.activeTextEditor?.document.uri;
        if (target?.scheme === "maixsftp") {
          Instance.instance.sftpService.refresh(target);
        } else {
          Instance.instance.sftpService.refresh();
        }
      },
    },

    {
      name: Commands.configureProject,
      func: async (uri?: vscode.Uri) => {
        await Instance.instance.projectDeployService.configureProject(
          projectDirHint(uri)
        );
      },
    },
    {
      name: Commands.packageApp,
      func: async (uri?: vscode.Uri) => {
        await Instance.instance.projectDeployService.packageProject(
          projectDirHint(uri)
        );
      },
    },
    {
      name: Commands.installApp,
      func: async (uri?: vscode.Uri) => {
        await Instance.instance.projectDeployService.installToDevice(
          projectDirHint(uri)
        );
      },
    },
    {
      name: Commands.packageAndInstallApp,
      func: async (uri?: vscode.Uri) => {
        await Instance.instance.projectDeployService.packageAndInstall(
          projectDirHint(uri)
        );
      },
    },
    {
      name: Commands.runProject,
      func: async (uri?: vscode.Uri) => {
        await Instance.instance.projectDeployService.runProject(
          projectDirHint(uri)
        );
      },
    },

    {
      name: Commands.installRuntime,
      func: async () => {
        await Instance.instance.runtimeService.installOrUpdateRuntime();
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
