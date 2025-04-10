import { EventEmitter } from "events";
import { DeviceService } from "../service/device_service";
import { Status } from "../model/status";

export interface FileAccessor {
  isWindows: boolean;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export class MaixPyRuntime extends EventEmitter {
  // the initial (and one and only) file we are 'debugging'
  private _sourceFile: string = "";
  public get sourceFile() {
    return this._sourceFile;
  }
  private device?: DeviceService;

  constructor(private fileAccessor: FileAccessor) {
    super();
  }
  /**
   * Start executing the given program.
   */
  public async start(
    program: string,
    // stopOnEntry: boolean,
    // debug: boolean,
    device: DeviceService
  ): Promise<void> {
    if (device.status !== Status.online || !device.wss) {
      this.sendEvent("out", "err", "Device is not connected");
      this.sendEvent("end");
      return;
    }
    var sourceFile = await this.loadSource(
      this.normalizePathAndCasing(program)
    );

    if (!sourceFile) {
      this.sendEvent("out", "err", "Source file not found");
      this.sendEvent("end");
      return;
    }

    this.device = device;
    // run the program!
    device.wss.on("output", (text) => {
      this.sendEvent("output", "out", text);
    });

    device.wss.on("runAck", (content) => {
      if (content[0] !== 1) {
        this.sendEvent(
          "output",
          "err",
          "Failed to run code, return " + content
        );
        // this.sendEvent("end");
      }
    });

    device.wss.on("end", () => {
      this.sendEvent("end");
    });

    device.wss.on("error", (err) => {
      this.sendEvent("output", "err", err);
      this.sendEvent("end");
    });

    device.wss.on("finish", () => {
      this.sendEvent("end");
    });

    device.wss.on("img", (data: ArrayBuffer) => {
      this.sendEvent("img", data);
    });

    device.wss.runCode(sourceFile.toString());
  }

  public stop(): void {
    if (this?.device?.wss) {
      this.device.wss.stopCode();
    }
  }

  private sendEvent(event: string, ...args: any[]): void {
    setTimeout(() => {
      this.emit(event, ...args);
    }, 0);
  }

  private async loadSource(file: string) {
    if (this._sourceFile !== file) {
      this._sourceFile = this.normalizePathAndCasing(file);
      return await this.fileAccessor.readFile(file);
    }
  }

  private normalizePathAndCasing(path: string) {
    if (this.fileAccessor.isWindows) {
      return path.replace(/\//g, "\\").toLowerCase();
    } else {
      return path.replace(/\\/g, "/");
    }
  }
}
