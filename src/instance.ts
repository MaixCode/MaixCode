import * as vscode from "vscode";
import { DeviceService } from "./service/device_service";
import { DiscoveryService } from "./service/discovery_service";
import { WebSocketService } from "./service/websocket_service";
import { Sidebar } from "./ui/sidebar";
import { StatusBar } from "./ui/statusbar";
import { Status } from "./model/status";

export class Instance {
  public static instance: Instance;

  public deviceService: DeviceService;
  public discoveryService: DiscoveryService;
  public siderbar: Sidebar;
  public statusbar: StatusBar;
  public onStatusChange: (status: Status) => void = () => {};
  private status: Status = Status.offline;
  // public websocket_service: WebSocketService

  private constructor(context: vscode.ExtensionContext) {
    this.deviceService = new DeviceService(context);
    this.discoveryService = new DiscoveryService(context);
    this.siderbar = new Sidebar(context);
    this.statusbar = new StatusBar();
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
    return this.status;
  }
}
