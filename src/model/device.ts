import { log } from "../logger";

export class DeviceAddr {
  constructor(public name: string, public ip: string) {}
}

export class DeviceInfo {
  constructor(
    public sysVer?: string,
    public maixpyVer?: string,
    public apiKey?: string,
    /** Device model string from device, e.g. MaixCAM / MaixCAM-Pro / MaixCAM2 */
    public device?: string,
    /** Installed MaixVision runtime version on device (empty if not installed) */
    public runtime?: string
  ) {}

  public static fromText(text: string) {
    let data = JSON.parse(text);
    log(`[DeviceInfo] parsed device=${data.device} sysVer=${data.sysVer} maixpyVer=${data.maixpyVer} runtime=${data.runtime}`);
    return new DeviceInfo(
      data.sysVer,
      data.maixpyVer,
      data.apiKey,
      data.device,
      data.runtime
    );
  }
}
