import * as vscode from "vscode";
import { DiscoveryService } from "./Service/discovery_service";
import { initCommands } from "./command";
import { initLogger, log } from "./logger";
import { Sidebar } from "./ui/sidebar";
import { SecondarySidebar } from "./ui/secondary_sidebar";
import { StatusBar } from "./ui/statusbar";

export function activate(context: vscode.ExtensionContext) {
  // Initialize logger
  initLogger(context);
  log("MaixCode is now active!");
  // Initialize services
  const discoveryService = new DiscoveryService(context);
  discoveryService.start();

  const sidebar = new Sidebar(context, () => discoveryService.getDevices());
  const secondarySidebar = new SecondarySidebar(context);
  const statusBar = new StatusBar();

  discoveryService.onDeviceChanged = () => sidebar.refresh();

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
