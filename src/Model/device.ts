import { WebSocketService } from "../Service/websocket_service";

export class Device {
  constructor(
    public name: string,
    public ip: string,
    public wss?: WebSocketService,
    public status: DeviceStatus = DeviceStatus.unknown
  ) {}
}

export enum DeviceStatus {
  online,
  connected,
  offline,
  unknown,
}
