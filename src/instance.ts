import * as vscode from "vscode";
import { DiscoveryService } from "./service/discovery_service";
import { Sidebar } from "./ui/sidebar";
import { StatusBar } from "./ui/statusbar";
import { Status } from "./model/status";
import { ExampleFileProvider } from "./ui/provider/example";
import { DeviceManager } from "./service/device_manager";
import { ImageViewer } from "./ui/provider/image_viewer";
import { ImageService } from "./service/image_service";
import { SshTerminalService } from "./service/ssh/ssh_terminal_service";
import { SftpService } from "./service/ssh/sftp_service";
import { ConfigKeys, ConfigSection } from "./constants";
import { ProjectDeployService } from "./service/project_deploy_service";
import { AppConfigEditor } from "./ui/provider/app_config_editor";
import { RuntimeService } from "./service/runtime_service";
import { workspaceFileAccessor } from "./debugger/file_accessor";

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
  public sshTerminalService: SshTerminalService;
  public sftpService: SftpService;
  public projectDeployService: ProjectDeployService;
  public appConfigEditor: AppConfigEditor;
  public runtimeService: RuntimeService;
  public onStatusChange: (status: Status) => void = () => {};
  private status: Status = Status.offline;

  private connectionListeners = new Set<() => void>();

  private constructor(context: vscode.ExtensionContext) {
    this.imageService = new ImageService(context);
    this.sshTerminalService = new SshTerminalService(context);
    this.sftpService = new SftpService(context);
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
        // drop frames for keys no longer connected
        const live = new Set(
          this.deviceManager.getConnectedDevice().map((d) => {
            const name = d.device?.name;
            const ip = d.device?.ip;
            return name || ip || "Undefined";
          })
        );
        for (const key of this.imageService.store.keys()) {
          if (!live.has(key)) {
            this.imageService.clearKey(key);
          }
        }
        for (const listener of this.connectionListeners) {
          try {
            listener();
          } catch {
            // ignore
          }
        }
        this.sftpService.tryAutoOpenFromConnected(
          this.deviceManager.getConnectedDevice().map((d) => ({
            host: d.device?.ip || "",
            deviceName: d.device?.name,
          }))
        );
      },
    });

    this.discoveryService.onDeviceChanged = (devices) => {
      this.sidebar.refresh();
      this.deviceManager.tryAutoConnect(devices);
    };

    this.imageViewer = new ImageViewer(context, {
      imageService: this.imageService,
      listConnectedDevices: () =>
        this.deviceManager.getConnectedDevice().map((d) => ({
          key: d.device?.name || d.device?.ip || "Undefined",
          name: d.device?.name || "Unknown",
          ip: d.device?.ip || "",
        })),
      onConnectionListChanged: (listener) => {
        this.connectionListeners.add(listener);
        return () => {
          this.connectionListeners.delete(listener);
        };
      },
    });

    this.projectDeployService = new ProjectDeployService({
      getConnectedDevices: () => this.deviceManager.getConnectedDevice(),
      getCurrentDevice: () => this.deviceManager.getCurrentDevice(),
      fileAccessor: workspaceFileAccessor,
    });

    this.appConfigEditor = new AppConfigEditor(context, {
      packageService: this.projectDeployService.packageService,
    });

    this.runtimeService = new RuntimeService({
      getConnectedDevices: () => this.deviceManager.getConnectedDevice(),
      getCurrentDevice: () => this.deviceManager.getCurrentDevice(),
    });

    context.subscriptions.push({
      dispose: () => {
        this.sshTerminalService.dispose();
        this.sftpService.dispose();
      },
    });

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
            `${ConfigSection}.${ConfigKeys.autoOpenSftp}`
          )
        ) {
          this.sftpService.tryAutoOpenFromConnected(
            this.deviceManager.getConnectedDevice().map((d) => ({
              host: d.device?.ip || "",
              deviceName: d.device?.name,
            }))
          );
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
