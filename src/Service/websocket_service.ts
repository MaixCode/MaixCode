import { info, error } from "../logger";
import ws from "ws";

const HEADER = Uint8Array.of(172, 190, 203, 202);
const VERSION = Uint8Array.of(0);
const COMMAND = {
  Auth: 1,
  AuthAck: 2,
  Run: 3,
  RunAck: 4,
  Output: 5,
  Img: 6,
  Stop: 7,
  StopAck: 8,
  Finish: 9,
  Msg: 10,
  Heartbeat: 11,
  DeviceInfo: 12,
  DeviceInfoAck: 13,
  ImgFormat: 14,
  ImgFormatAck: 15,
  InstallApp: 16,
  InstallAppAck: 17,
  RunProject: 18,
};

function num2Uint8Array(num: number) {
  const arr = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    arr[i] = num % 256;
    num = Math.floor(num / 256);
  }
  return arr;
}

function packUint32(value: number) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value, true);
  return Array.from(new Uint8Array(buffer));
}

export class WebSocketService {
  private ws: ws.WebSocket;

  constructor(
    readonly ip: string,
    readonly port: number = 7899,
    private hookOpen: () => void = () => {},
    private hookClose: (code: number, reason: Buffer) => void = () => {},
    private hookError: (
      err: Error | { code: number; msg: string }
    ) => void = () => {},
    private hookImg: (data: ArrayBuffer) => void = () => {}
  ) {
    this.ws = new ws.WebSocket(`ws://${ip}:${port}`);
    this.ws.binaryType = "arraybuffer";

    this.ws.on("open", this.onOpen);
    this.ws.on("message", this.onMessage);
    this.ws.on("close", this.onClose);
    this.ws.on("error", this.onError);
  }
  static packMessage(cmd: number, data: number | string | Buffer) {
    if (typeof data === "number") {
      data = Buffer.from(num2Uint8Array(data));
    } else if (typeof data === "string") {
      data = Buffer.from(data);
    }
    const frameData = new Uint8Array([...VERSION, cmd, ...data]);
    const message = new Uint8Array([
      ...HEADER,
      ...packUint32(frameData.length + 1),
      ...frameData,
    ]);
    const checksum = message.reduce((a, b) => a + b, 0) % 256;
    return new Uint8Array([...message, checksum]);
  }
  public sendMessage(cmd: number, data: number | string | Buffer) {
    this.ws.send(WebSocketService.packMessage(cmd, data));
  }
  private onOpen() {
    this.sendMessage(COMMAND.Auth, "maixvision");
    this.hookOpen();
  }
  private onMessage(message: ArrayBuffer) {
    const result = this.unpackMessage(message);
    if (result) {
      this.handleCommand(result.cmd, result.content);
    }
  }
  private onError(err: Error) {
    error(err);
    this.hookError(err);
  }
  private onClose(code: number, reason: Buffer) {
    this.hookClose(code, reason);
  }
  private unpackMessage(
    message: ArrayBuffer,
    wishCmd?: number
  ): { cmd: number; content: Uint8Array } | undefined {
    const data = new Uint8Array(message);
    const header = data.slice(0, 4);
    if (!header.every((value, index) => value === HEADER[index])) {
      return;
    }
    const dataLen = data
      .slice(4, 8)
      .reduce((acc, value, index) => acc + (value << (index * 8)), 0);
    if (data.length - 8 < dataLen) {
      return;
    }
    if (
      data.slice(0, -1).reduce((acc, value) => acc + value, 0) % 256 !==
      data[dataLen + 7]
    ) {
      return;
    }
    const cmd = data[9];
    if (wishCmd && cmd !== wishCmd) {
      return;
    }
    const content = data.slice(10, 10 + dataLen - 3);
    return { cmd, content };
  }
  private handleCommand(cmd: number, content: Uint8Array) {
    switch (cmd) {
      case COMMAND.AuthAck: {
        const ok = this.authCommand(content);
        if (ok) {
          this.sendMessage(COMMAND.DeviceInfo, "");
        } else {
          // disconnect$1();
        }
        break;
      }
      case COMMAND.RunAck:
        this.runAckCommand(content);
        break;
      case COMMAND.Output:
        this.outputCommand(content);
        break;
      case COMMAND.Img:
        this.imgCommand(content);
        break;
      case COMMAND.StopAck:
        this.stopAckCommand(content);
        break;
      case COMMAND.Finish:
        this.finishCommand(content);
        break;
      case COMMAND.Msg:
        this.msgCommand(content);
        break;
      case COMMAND.Heartbeat:
        this.sendMessage(COMMAND.Heartbeat, "");
        break;
      case COMMAND.DeviceInfoAck:
        this.deviceInfoAckCommand(content);
        break;
      case COMMAND.ImgFormatAck:
        this.imgFormatCommand(content);
        break;
      case COMMAND.InstallAppAck:
        this.installAppAckCommand(content);
        break;
      default:
        // log;
        break;
    }
  }
  private authCommand(content: Uint8Array) {
    const isSuccess = content[0] === 1;
    if (isSuccess) {
      info("connect device successful");
    } else {
      const msg = `connect device failed: ${Buffer.from(
        content.slice(1)
      ).toString()}`;
      error(msg);
      this.hookError({ code: -2, msg });
    }
    return isSuccess;
  }
  private runAckCommand(content: Uint8Array) {
    const isSuccess = content[0] === 1;
    if (isSuccess) {
      info("start running...");
    } else {
      const msg = `device execute code failed: ${Buffer.from(
        content.slice(1)
      )}`;
      error(msg);
      this.hookError({ code: -1, msg });
    }
  }
  private outputCommand(content: Uint8Array) {
    const data = Buffer.from(content).toString();
  }
  private imgCommand(content: Uint8Array) {
    this.hookImg(content.slice(1));
    // sharp(content.slice(1))
    //   .raw()
    //   .ensureAlpha()
    //   .toBuffer({ resolveWithObject: true })
    //   .then(({ data, info }) => {
    //     const rsp = {
    //       data: data.buffer,
    //       type: content[0] === 1 ? "jpeg" : "png",
    //       width: info.width,
    //       height: info.height,
    //     };
    //   });
  }
  private stopAckCommand(content: Uint8Array) {
    const isSuccess = content[0] === 1;
    const rsp = isSuccess
      ? { code: 0, msg: "stop running success" }
      : {
          code: -1,
          msg: `stop running failed: ${Buffer.from(
            content.slice(1)
          ).toString()}`,
        };
  }
  private finishCommand(content: Uint8Array) {
    const isSuccess = content.slice(0, 4).every((a) => a === 0);
    let rsp;
    if (isSuccess) {
      rsp = { code: 0, msg: "program exited" };
    } else {
      const view = new DataView(content.slice(0, 4).buffer, 0);
      const code = view.getUint32(0, true);
      const err = Buffer.from(content.slice(4)).toString();
      const msg2 = `program exit failed. exit code: ${code}. ${
        err ? "msg: " + err : ""
      }`;
      rsp = { code, msg: msg2 };
    }
  }
  private msgCommand(content: Uint8Array) {
    return Buffer.from(content).toString();
  }
  private deviceInfoAckCommand(content: Uint8Array) {
    return Buffer.from(content).toString();
  }
  private imgFormatCommand(content: Uint8Array) {
    const isSuccess = content[0] === 1;
    const rsp = isSuccess
      ? {
          code: 0,
          format: content[1] === 1 ? "JPEG" : content[1] === 2 ? "PNG" : "",
          msg: "success",
        }
      : {
          code: -1,
          format: "",
          msg: Buffer.from(content.slice(2)).toString(),
        };
  }
  private installAppAckCommand(content: Uint8Array) {
    const isSuccess = content[1] === 0;
    const rsp = isSuccess
      ? {
          code: 0,
          progress: content[0],
          msg: "success",
        }
      : {
          code: -1,
          progress: 0,
          msg: Buffer.from(content.slice(2)).toString(),
        };
  }
}
