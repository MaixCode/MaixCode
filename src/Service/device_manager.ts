import * as vscode from "vscode";
import { Device } from "./device";
import { DeviceStatus } from "../model/device_status";

class DeviceManager {
  private devices: Device[] = [];

  constructor(private context: vscode.ExtensionContext) {
    let _devices = this.context.globalState.get("maixcode.devices") || [];
  }

  public addDevice(device: Device) {
    this.devices.push(device);
  }

  public addDevices(devices: Device[]) {
    this.devices.push(...devices);
  }

  public getDeviceByIp(ip: string) {
    return this.devices.filter((device) => device.ip === ip);
  }

  public getDeviceByName(name: string) {
    return this.devices.filter((device) => device.name === name);
  }

  public getDevices() {
    return this.devices;
  }

  public isOnline(name: string) {
    const device = this.getDeviceByName(name);
    return (
      device.length > 0 &&
      device.some((device) => device.status === DeviceStatus.online)
    );
  }

  public save() {
    // Save devices to local storage
    this.context.globalState.update("maixcode.devices", this.devices);
  }
}
