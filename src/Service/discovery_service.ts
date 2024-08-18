import { log } from "../logger";
import multicastDns from "multicast-dns";
import * as vscode from "vscode";
import os from "os";
import { Device } from "../Service/device";
import { DeviceStatus } from "../Model/device_status";

export class DiscoveryService {
  // private devices: Device[] = [];
  private devices: { device: Device; lastSeen: number }[] = [];
  private interfacePair: {
    ip: String;
    interface: multicastDns.MulticastDNS;
  }[] = [];
  private discoverTimeout?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    public readonly prefix: string = "maixcam",
    public readonly discoverDelayMs: number = 1000,
    public readonly timeoutMs: number = 4000,
    public onDeviceChanged: (device: Device[]) => void = () => {},
    public connectCallback: (device: Device) => void = () => {}
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.discoverDevices", this.discover)
    );
  }

  public stop(): void {
    if (this.discoverTimeout) {
      clearTimeout(this.discoverTimeout);
    }
    this.destroy();
  }

  public start(): void {
    this.discoverLoop();
  }

  private discoverLoop(): void {
    this.discover();
    this.discoverTimeout = setTimeout(() => {
      this.destroy();
      this.discoverLoop();
    }, this.discoverDelayMs);
  }

  private createResponseHandler(
    mdns: multicastDns.MulticastDNS
  ): (response: multicastDns.ResponsePacket) => void {
    return (response: multicastDns.ResponsePacket) => {
      for (let answer of response.answers) {
        if (
          answer.type === "PTR" &&
          answer.name === "_ssh._tcp.local" &&
          answer.data.startsWith(this.prefix)
        ) {
          const domain = answer.data.replace("._ssh._tcp", "");
          mdns.query([{ name: domain, type: "A" }]);
        } else if (answer.type === "A" && answer.name.startsWith(this.prefix)) {
          // Update device last seen
          let _device = this.devices.find(
            (device) => device.device.ip === answer.data
          );
          if (_device) {
            _device.lastSeen = Date.now();
            continue;
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
          this.devices.push({ device: device, lastSeen: Date.now() });
          this.onDeviceChanged(this.devices.map((device) => device.device));
        }
      }
    };
  }

  public discover(): void {
    const networkInterfaces = os.networkInterfaces();

    for (let interfaceName in networkInterfaces) {
      if (networkInterfaces && networkInterfaces[interfaceName]) {
        for (let info of networkInterfaces[interfaceName]) {
          if (info.internal || info.family !== "IPv4") {
            continue;
          }
          if (this.interfacePair.some((iface) => iface.ip === info.address)) {
            continue;
          }
          const mdns = multicastDns({
            bind: "0.0.0.0",
            interface: info.address,
            ttl: 255,
          });
          mdns.on("response", this.createResponseHandler(mdns));
          mdns.on("error", (err) => {
            log(`mDNS error: ${err}`);
            this.interfacePair = this.interfacePair.filter(
              (iface) => iface.ip !== info.address
            );
          });
          mdns.on("warning", (warn) => {
            log(`mDNS warning: ${warn}`);
          });
          this.interfacePair.push({
            ip: info.address,
            interface: mdns,
          });
        }
      }
    }

    for (let pair of this.interfacePair) {
      pair.interface.query([{ name: "_ssh._tcp.local", type: "PTR" }]);
    }

    // check if timeout
    let _device = this.devices.filter(
      (device) => Date.now() - device.lastSeen < this.timeoutMs
    );
    if (_device.length !== this.devices.length) {
      this.devices = _device;
      this.onDeviceChanged(this.devices.map((device) => device.device));
    }
  }

  public getDevices(): Device[] {
    return this.devices.map((device) => device.device);
  }

  public destroy(): void {
    for (let pair of this.interfacePair) {
      pair.interface.destroy();
    }
    this.interfacePair = [];
  }
}
