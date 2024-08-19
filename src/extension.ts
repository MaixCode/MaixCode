import * as vscode from "vscode";
import { DiscoveryService } from "./service/discovery_service";
import { initCommands } from "./command";
import { initLogger, log } from "./logger";
import { Sidebar } from "./ui/sidebar";
import { SecondarySidebar } from "./ui/secondary_sidebar";
import { StatusBar } from "./ui/statusbar";
import { DeviceManager } from "./service/device_manager";
import { DeviceService } from "./service/device_service";

export function activate(context: vscode.ExtensionContext) {
  // Initialize logger
  initLogger(context);
  log("MaixCode is now active!");
  // Initialize services
  const discoveryService = new DiscoveryService(context);
  discoveryService.start();

  const deviceService = new DeviceService(context);

  const sidebar = new Sidebar(context, () => discoveryService.getDevices());
  const secondarySidebar = new SecondarySidebar(context);
  const statusBar = new StatusBar();
  const deviceManager = new DeviceManager(context);

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
