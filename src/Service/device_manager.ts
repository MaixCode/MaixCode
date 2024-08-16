import { Device, DeviceStatus } from "../Model/device";

class DeviceManager {
  private devices: Device[] = [];

  public addDevice(device: Device) {
    this.devices.push(device);
  }

  public getDeviceByIp(ip: string) {
    return this.devices.find((device) => device.ip === ip);
  }

  public getDeviceByName(name: string) {
    return this.devices.find((device) => device.name === name);
  }

  public getDevices() {
    return this.devices;
  }
}
