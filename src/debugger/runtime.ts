import { EventEmitter } from "events";
import { DeviceService } from "../service/device_service";
import { Status } from "../model/status";
import { DeviceTransport } from "../ports/device_transport";
import { RunSession } from "../service/run_session";

export interface FileAccessor {
  isWindows: boolean;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
}

export class MaixPyRuntime extends EventEmitter {
  private _sourceFile: string = "";
  public get sourceFile() {
    return this._sourceFile;
  }

  private runSession?: RunSession;

  constructor(private fileAccessor: FileAccessor) {
    super();
  }

  /**
   * Start executing the given program on a connected device.
   * Accepts DeviceService or a bare DeviceTransport.
   */
  public async start(
    program: string,
    device: DeviceService | DeviceTransport
  ): Promise<void> {
    this.clearSession();

    const transport = this.resolveTransport(device);
    if (!transport || !transport.isConnected) {
      this.sendEvent("output", "err", "Device is not connected");
      this.sendEvent("end");
      return;
    }

    if (device instanceof DeviceService && device.status === Status.offline) {
      this.sendEvent("output", "err", "Device is not connected");
      this.sendEvent("end");
      return;
    }

    const sourceFile = await this.loadSource(
      this.normalizePathAndCasing(program)
    );

    if (!sourceFile) {
      this.sendEvent("output", "err", "Source file not found");
      this.sendEvent("end");
      return;
    }

    const session = new RunSession(transport);
    this.runSession = session;

    session.start(Buffer.from(sourceFile).toString("utf8"), {
      onOutput: (text) => this.sendEvent("output", "out", text),
      onError: (msg) => this.sendEvent("output", "err", msg),
      onEnd: () => {
        if (this.runSession === session) {
          this.runSession = undefined;
        }
        this.sendEvent("end");
      },
      onImg: (data) => this.sendEvent("img", data),
    });
  }

  public stop(): void {
    this.runSession?.stop();
  }

  public dispose(): void {
    this.clearSession();
  }

  private clearSession() {
    if (this.runSession) {
      this.runSession.stop();
      this.runSession.dispose();
      this.runSession = undefined;
    }
  }

  private resolveTransport(
    device: DeviceService | DeviceTransport
  ): DeviceTransport | undefined {
    if (device instanceof DeviceService) {
      return device.transport;
    }
    return device;
  }

  private sendEvent(event: string, ...args: any[]): void {
    setTimeout(() => {
      this.emit(event, ...args);
    }, 0);
  }

  private async loadSource(file: string): Promise<Uint8Array | undefined> {
    this._sourceFile = this.normalizePathAndCasing(file);
    try {
      return await this.fileAccessor.readFile(file);
    } catch {
      return undefined;
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
