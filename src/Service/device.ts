import { WebSocketService } from "./websocket_service";
import { info, warn, error } from "../logger";
import { DeviceStatus } from "../model/device_status";

export class Device {
  constructor(
    public name: string,
    public ip: string,
    public wss?: WebSocketService,
    public status: DeviceStatus = DeviceStatus.unknown
  ) {}

  public connect() {
    if (this.status !== DeviceStatus.offline || !this.wss) {
      warn(`Device ${this.name} is already connected or offline`);
      return;
    }
    this.wss = new WebSocketService(this.ip);
    this.wss.connect();
  }
}
