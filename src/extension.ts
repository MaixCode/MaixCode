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
