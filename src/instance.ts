import * as vscode from "vscode";
import { DiscoveryService } from "./service/discovery_service";
import { Sidebar } from "./ui/sidebar";
import { StatusBar } from "./ui/statusbar";
import { Status } from "./model/status";
import { ExampleFileProvider } from "./ui/provider/example";
import { DeviceManager } from "./service/device_manager";
import { ImageViewer } from "./ui/provider/image_viewer";
import { ImageService } from "./service/image_service";
import { ConfigKeys, ConfigSection } from "./constants";

/**
 * Composition root: wires services and UI.
 * Lower layers (protocol/discovery/device) must not import this class.
 */
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
    this.imageService = new ImageService(context);
    this.discoveryService = new DiscoveryService(context);
    this.sidebar = new Sidebar(context);
    this.statusbar = new StatusBar();
    this.exampleFileProvider = new ExampleFileProvider(context);

    this.deviceManager = new DeviceManager(context, {
      getDiscoveredDevices: () => this.discoveryService.getDevices(),
      onFrame: (deviceKey, data) => {
        this.imageService.setImage(deviceKey, data);
      },
      onConnectionListChanged: () => {
        this.sidebar.refresh();
        this.statusbar.updateByStatus(this.deviceManager.getStatus());
      },
    });

    this.discoveryService.onDeviceChanged = (devices) => {
      this.sidebar.refresh();
      this.deviceManager.tryAutoConnect(devices);
    };

    this.imageViewer = new ImageViewer(context, this.imageService);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.autoConnect}`
          ) ||
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.autoConnectTarget}`
          )
        ) {
          this.deviceManager.clearAutoConnectSuppress();
          this.deviceManager.tryAutoConnect();
        }
        if (
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.enableDeviceDiscovery}`
          )
        ) {
          const enabled = vscode.workspace
            .getConfiguration(ConfigSection)
            .get<boolean>(ConfigKeys.enableDeviceDiscovery, true);
          if (enabled) {
            this.discoveryService.start();
          } else {
            this.discoveryService.stop();
          }
        }
      })
    );
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
