import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { initCommands } from "./command";
import { error, initLogger, log } from "./logger";
import { DebugAdapterFactory } from "./debugger/debugger";
import { Instance } from "./instance";
import { ConfigKeys, ConfigSection, DebugTypeName } from "./constants";
import { resolveSourceForRun } from "./debugger/source_resolve";

function fileLaunchConfig(
  program?: string
): vscode.DebugConfiguration {
  return {
    type: DebugTypeName,
    request: "launch",
    name: vscode.l10n.t("MaixPy: Run Current File on Device"),
    program: program || "${file}",
    mode: "file",
    noDebug: true,
  };
}

function projectLaunchConfig(
  projectDir?: string
): vscode.DebugConfiguration {
  const dir = projectDir || "${workspaceFolder}";
  return {
    type: DebugTypeName,
    request: "launch",
    name: vscode.l10n.t("MaixPy: Run Project on Device"),
    program: dir,
    mode: "project",
    projectDir: dir,
    noDebug: true,
  };
}

function resolveWorkspaceProjectDir(
  folder: vscode.WorkspaceFolder | undefined
): string | undefined {
  if (folder?.uri.scheme === "file") {
    return folder.uri.fsPath;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0 && folders[0].uri.scheme === "file") {
    return folders[0].uri.fsPath;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme === "file") {
    const wf = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (wf?.uri.scheme === "file") {
      return wf.uri.fsPath;
    }
    return path.dirname(editor.document.uri.fsPath);
  }
  return undefined;
}

async function pickRunMode(): Promise<"file" | "project" | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t("$(play) Run Current File"),
        description: vscode.l10n.t("Send active Python file to device (Run)"),
        mode: "file" as const,
      },
      {
        label: vscode.l10n.t("$(run-all) Run Project"),
        description: vscode.l10n.t("Zip workspace folder and RunProject on device"),
        mode: "project" as const,
      },
    ],
    {
      title: vscode.l10n.t("MaixPy Debug"),
      placeHolder: vscode.l10n.t("Choose how to run on MaixCAM"),
    }
  );
  return pick?.mode;
}

const maixpyDebugConfigurationProvider: vscode.DebugConfigurationProvider = {
  provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    const projectDir = resolveWorkspaceProjectDir(folder);
    return [
      fileLaunchConfig(),
      projectLaunchConfig(projectDir || "${workspaceFolder}"),
    ];
  },

  async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration
  ): Promise<vscode.DebugConfiguration | undefined> {
    log(
      `[DebugConfigurationProvider] resolve ${JSON.stringify(config)} folder=${folder?.uri?.fsPath}`
    );

    // Completely empty config (F5 with no launch.json / no selection): ask user
    const isEmpty =
      !config.type &&
      !config.request &&
      !config.name &&
      !config.program &&
      !config.mode;

    if (isEmpty || (!config.mode && !config.program && !config.name)) {
      const mode = await pickRunMode();
      if (!mode) {
        return undefined;
      }
      if (mode === "project") {
        config = projectLaunchConfig(resolveWorkspaceProjectDir(folder));
      } else {
        config = fileLaunchConfig();
      }
    }

    if (!config.type) {
      config.type = DebugTypeName;
    }
    if (!config.request) {
      config.request = "launch";
    }

    const mode = config.mode === "project" ? "project" : "file";
    config.mode = mode;

    if (mode === "project") {
      let projectDir =
        (typeof config.projectDir === "string" && config.projectDir) ||
        (typeof config.program === "string" && config.program) ||
        resolveWorkspaceProjectDir(folder);
      // Expand common VS Code variables lightly
      if (projectDir === "${workspaceFolder}" || !projectDir) {
        projectDir = resolveWorkspaceProjectDir(folder);
      }
      if (!projectDir || !fs.existsSync(projectDir)) {
        vscode.window.showErrorMessage(
          vscode.l10n.t("MaixPy Run Project: open a workspace folder (or a file under the project) first.")
        );
        return undefined;
      }
      config.projectDir = projectDir;
      config.program = projectDir;
      if (!config.name) {
        config.name = vscode.l10n.t("MaixPy: Run Project on Device");
      }
      log(
        `[DebugConfigurationProvider] project mode projectDir=${projectDir}`
      );
      return config;
    }

    // file mode
    if (!config.name) {
      config.name = vscode.l10n.t("MaixPy: Run Current File on Device");
    }
    try {
      const resolved = resolveSourceForRun(
        typeof config.program === "string" ? config.program : undefined
      );
      config.program = resolved.fsPath || resolved.label;
      log(
        `[DebugConfigurationProvider] file mode program=${config.program}`
      );
    } catch (e) {
      log(`[DebugConfigurationProvider] resolve failed: ${e}`);
      vscode.window.showErrorMessage(
        vscode.l10n.t("MaixPy Run File: open a Python file (or untitled buffer) first.")
      );
      return undefined;
    }
    return config;
  },
};

export function activate(context: vscode.ExtensionContext) {
  try {
    initLogger(context);
    log("MaixCode is now active!");
    log(`Registering debug type: ${DebugTypeName}`);

    Instance.initInstance(context);
    log("Instance initialized");

    const discoveryEnabled = vscode.workspace
      .getConfiguration(ConfigSection)
      .get<boolean>(ConfigKeys.enableDeviceDiscovery, true);
    if (discoveryEnabled) {
      Instance.instance.discoveryService.start();
      log("Discovery service started");
    } else {
      log("Device discovery disabled by settings");
    }

    const factory = new DebugAdapterFactory();
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterDescriptorFactory(DebugTypeName, factory)
    );
    log(`DebugAdapterDescriptorFactory registered for type=${DebugTypeName}`);

    // Initial: seed launch.json when user creates config
    context.subscriptions.push(
      vscode.debug.registerDebugConfigurationProvider(
        DebugTypeName,
        maixpyDebugConfigurationProvider,
        vscode.DebugConfigurationProviderTriggerKind.Initial
      )
    );
    // Dynamic: appear in F5 / Run and Debug configuration picker
    context.subscriptions.push(
      vscode.debug.registerDebugConfigurationProvider(
        DebugTypeName,
        maixpyDebugConfigurationProvider,
        vscode.DebugConfigurationProviderTriggerKind.Dynamic
      )
    );
    // Also resolve static launch.json entries (default trigger)
    context.subscriptions.push(
      vscode.debug.registerDebugConfigurationProvider(
        DebugTypeName,
        maixpyDebugConfigurationProvider
      )
    );
    log("DebugConfigurationProvider registered (Initial + Dynamic + default)");

    context.subscriptions.push(
      vscode.debug.onDidStartDebugSession((session) => {
        log(
          `onDidStartDebugSession type=${session.type} name=${session.name} id=${session.id}`
        );
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        log(
          `onDidTerminateDebugSession type=${session.type} name=${session.name} id=${session.id}`
        );
      })
    );

    // Dispose status bar with extension
    context.subscriptions.push({
      dispose: () => Instance.instance?.statusbar?.dispose(),
    });

    initCommands(context);
    log("Commands registered");
  } catch (e) {
    error(e instanceof Error ? e : String(e), true);
    throw e;
  }
}

export function deactivate() {}
