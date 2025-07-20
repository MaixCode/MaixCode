import * as vscode from "vscode";
import { initCommands } from "./command";
import { error, initLogger, log } from "./logger";
import { DebugAdapterFactory } from "./debugger/debugger";
import { Instance } from "./instance";
import { DebugTypeName } from "./constants";

export function activate(context: vscode.ExtensionContext) {
  // Initialize logger
  initLogger(context);
  log("MaixCode is now active!");

  // Initialize instance
  Instance.initInstance(context);

  Instance.instance.discoveryService.start();

  // Instance.instance.imageViewer.showWindow();

  // Activate the debug adapter
  let factory = new DebugAdapterFactory();
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(DebugTypeName, factory)
  );
  vscode.window.registerTreeDataProvider(
    "maixcode-example",
    Instance.instance.exampleFileProvider
  );

  initCommands(context);

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
