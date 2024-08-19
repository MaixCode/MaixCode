import { DeviceService } from "../service/device_service";
import { DeviceStatus } from "./device_status";

export class Device {
  constructor(
    public name: string,
    public ip: string,
    public status: DeviceStatus = DeviceStatus.unknown
  ) {}
}
