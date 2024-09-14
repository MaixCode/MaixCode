import * as vscode from "vscode";
import { DeviceService } from "./device_service";

let __device: DeviceService | undefined = undefined;

export class DeviceManager {
  constructor(private context: vscode.ExtensionContext) {}
  static setDevice(device: DeviceService) {
    __device = device;
  }

  static getDevice() {
    if (__device) {
      return __device;
    }
  }

  static clearDevice() {
    __device = undefined;
  }
}
