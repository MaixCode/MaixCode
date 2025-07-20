import * as vscode from "vscode";
import { DeviceService } from "./service/device_service";
import { DiscoveryService } from "./service/discovery_service";
import { WebSocketService } from "./service/websocket_service";
import { Sidebar } from "./ui/sidebar";
import { StatusBar } from "./ui/statusbar";
import { Status } from "./model/status";
import { ExampleFileProvider } from "./ui/provider/example";
import { DeviceManager } from "./service/device_manager";
import { ImageViewer } from "./ui/provider/image_viewer";
import { ImageService } from "./service/image_service";

export class Instance {
  public static instance: Instance;

  public discoveryService: DiscoveryService;
  public imageService: ImageService;
  public deviceManager: DeviceManager;
  public sidebar: Sidebar;
  public statusbar: StatusBar;
  public exampleFileProvider: ExampleFileProvider;
  public imageViewer: ImageViewer;
  public onStatusChange: (status: Status) => void = () => {};
  private status: Status = Status.offline;

  private constructor(context: vscode.ExtensionContext) {
    this.deviceManager = new DeviceManager(context);
    this.discoveryService = new DiscoveryService(context);
    this.imageService = new ImageService(context);
    this.sidebar = new Sidebar(context);
    this.statusbar = new StatusBar();
    this.exampleFileProvider = new ExampleFileProvider(context);
    this.imageViewer = new ImageViewer(context, this.imageService);
  }

  static initInstance(context: vscode.ExtensionContext) {
    if (!Instance.instance) {
      Instance.instance = new Instance(context);
    }
  }

  public setStatus(status: Status) {
    this.status = status;
    this.statusbar.updateByStatus(status);
  }

  public getStatus() {
    return this.deviceManager.getStatus();
  }
}
