export class DeviceAddr {
  constructor(public name: string, public ip: string) {}
}

export class DeviceInfo {
  constructor(
    public sysVer?: string,
    public maixpyVer?: string,
    public apiKey?: string
  ) {}

  public static fromText(text: string) {
    let data = JSON.parse(text);
    return new DeviceInfo(data.sysVer, data.maixpyVer, data.apiKey);
  }
}
