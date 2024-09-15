import * as vscode from "vscode";
import { DeviceService } from "./device_service";

export class DeviceManager {
  constructor(private context: vscode.ExtensionContext) {}

  private static __device?: DeviceService;

  static setDevice(device: DeviceService) {
    this.__device = device;
  }

  static getDevice() {
    return this.__device;
  }

  static clearDevice() {
    this.__device = undefined;
  }
}
