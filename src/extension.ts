import * as vscode from "vscode";
import { initCommands } from "./command";
import { error, initLogger, log } from "./logger";
import { DebugAdapterFactory } from "./debugger/debugger";
import { Instance } from "./instance";
import { DebugTypeName } from "./constants";

export function activate(context: vscode.ExtensionContext) {
  try {
    initLogger(context);
    log("MaixCode is now active!");
    log(`Registering debug type: ${DebugTypeName}`);

    Instance.initInstance(context);
    log("Instance initialized");

    Instance.instance.discoveryService.start();
    log("Discovery service started");

    const factory = new DebugAdapterFactory();
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterDescriptorFactory(DebugTypeName, factory)
    );
    log(`DebugAdapterDescriptorFactory registered for type=${DebugTypeName}`);

    // Provide defaults when user picks MaixPy without a full launch.json entry
    context.subscriptions.push(
      vscode.debug.registerDebugConfigurationProvider(DebugTypeName, {
        resolveDebugConfiguration(folder, config) {
          log(
            `[DebugConfigurationProvider] resolve ${JSON.stringify(config)} folder=${folder?.uri?.fsPath}`
          );
          // Empty config (from "Add Configuration" / missing fields)
          if (!config.type) {
            config.type = DebugTypeName;
          }
          if (!config.request) {
            config.request = "launch";
          }
          if (!config.name) {
            config.name = "MaixPy: Run Current File on Device";
          }
          if (!config.program) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              config.program = editor.document.uri.fsPath;
              log(`[DebugConfigurationProvider] program from active editor: ${config.program}`);
            } else {
              log("[DebugConfigurationProvider] no program and no active editor");
              return undefined; // abort
            }
          }
          return config;
        },
      })
    );
    log("DebugConfigurationProvider registered");

    // Surface debug session lifecycle in the log
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

    initCommands(context);
    log("Commands registered");
  } catch (e) {
    error(e instanceof Error ? e : String(e), true);
    throw e;
  }

  // initCommands(context, [
  //   {
  //     name: "maixcode.helloWorld",
  //     func: () =>
  //       vscode.window.showInformationMessage("Hello World from MaixCode!"),
  //   },
  //   {
  //     name: "maixcode.discoverDevices",
  //     func: () => discoveryService.discover(),
  //   },
  // ]);
}

export function deactivate() {}
