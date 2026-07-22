import * as vscode from "vscode";
import { initCommands } from "./command";
import { error, initLogger, log } from "./logger";
import { DebugAdapterFactory } from "./debugger/debugger";
import { Instance } from "./instance";
import { DebugTypeName } from "./constants";
import { resolveSourceForRun } from "./debugger/source_resolve";

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
          try {
            const resolved = resolveSourceForRun(
              typeof config.program === "string" ? config.program : undefined
            );
            // Prefer absolute fs path; runtime can still use editor content for example:
            config.program = resolved.fsPath || resolved.label;
            log(
              `[DebugConfigurationProvider] resolved program=${config.program}`
            );
          } catch (e) {
            log(
              `[DebugConfigurationProvider] resolve failed: ${e}`
            );
            return undefined;
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
