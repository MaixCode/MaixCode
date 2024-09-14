import * as vscode from "vscode";
import { initCommands } from "./command";
import { initLogger, log } from "./logger";
import { DebugAdapterFactory } from "./debugger";
import { Instance } from "./instance";

export function activate(context: vscode.ExtensionContext) {
  // Initialize logger
  initLogger(context);
  log("MaixCode is now active!");

  // Initialize instance
  Instance.initInstance(context);

  Instance.instance.discoveryService.start();

  // const imageViewer = new ImageViewer(context);
  // imageViewer.showWindow();

  // Activate the debug adapter
  let factory = new DebugAdapterFactory();
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory("maixpy", factory)
  );

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
