import { log } from "../logger";
import multicastDns from "multicast-dns";
import * as vscode from "vscode";
import os from "os";
import { Device, DeviceStatus } from "../Model/device";

export class DiscoveryService {
  private devices: Device[];
  private interfaces: { ip: String; interface: multicastDns.MulticastDNS }[];
  private discoverTimeout?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    public readonly prefix: string = "maixcam",
    public readonly discoverDelayMs: number = 5000,
    public onDeviceChanged: (device: Device[]) => void = () => {},
    public connectCallback: (device: Device) => void = () => {}
  ) {
    this.devices = [];
    this.interfaces = [];
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.discoverDevices", this.discover)
    );
  }

  public stop(): void {
    if (this.discoverTimeout) {
      clearTimeout(this.discoverTimeout);
    }
    this.interfaces.forEach((interfaceName) => {
      interfaceName.interface.destroy();
    });
  }

  public start(): void {
    this.discoverLoop();
  }

  private discoverLoop(): void {
    this.discover();
    this.discoverTimeout = setTimeout(() => {
      this.discoverLoop();
    }, this.discoverDelayMs);
  }

  private createResponseHandler(
    mdns: multicastDns.MulticastDNS
  ): (response: multicastDns.ResponsePacket) => void {
    return (response: multicastDns.ResponsePacket) => {
      response.answers.forEach((answer) => {
        if (
          answer.type === "PTR" &&
          answer.name === "_ssh._tcp.local" &&
          answer.data.startsWith(this.prefix)
        ) {
          const domain = answer.data.replace("._ssh._tcp", "");
          mdns.query([{ name: domain, type: "A" }]);
        } else if (answer.type === "A" && answer.name.startsWith(this.prefix)) {
          if (this.devices.some((device) => device.ip === answer.data)) {
            return;
          }
          let device = new Device(answer.name, answer.data);
          device.status = DeviceStatus.offline;
          log(`Found device ${device.name} at ${device.ip}`);
          vscode.window
            .showInformationMessage(
              `Found device ${device.name} at ${device.ip}`,
              "Connect"
            )
            .then((selection) => {
              if (selection === "Connect") {
                this.connectCallback(device);
              }
            });
          this.devices.push(device);
          this.onDeviceChanged(this.devices);
        }
      });
    };
  }

  public discover(): void {
    const networkInterfaces = os.networkInterfaces();

    Object.keys(networkInterfaces).forEach((interfaceName) => {
      networkInterfaces[interfaceName]?.forEach((info) => {
        if (info.internal || info.family !== "IPv4") {
          return;
        }
        if (this.interfaces.some((iface) => iface.ip === info.address)) {
          return;
        }
        const mdns = multicastDns({
          bind: "0.0.0.0",
          interface: info.address,
          ttl: 255,
        });
        mdns.on("response", this.createResponseHandler(mdns));
        this.interfaces.push({
          ip: info.address,
          interface: mdns,
        });
      });
    });

    Object.values(this.interfaces).forEach((interfaceName) => {
      interfaceName.interface.query([{ name: "_ssh._tcp.local", type: "PTR" }]);
    });
  }

  public getDevices(): Device[] {
    return this.devices;
  }
}
