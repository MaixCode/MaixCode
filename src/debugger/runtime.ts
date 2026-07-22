import { EventEmitter } from "events";
import { DeviceService } from "../service/device_service";
import { Status } from "../model/status";
import { DeviceTransport } from "../ports/device_transport";
import { RunSession } from "../service/run_session";
import { error as logError, formatUnknown, log, warn } from "../logger";
import {
  readResolvedSource,
  resolveSourceForRun,
  ResolvedSource,
} from "./source_resolve";

export interface FileAccessor {
  isWindows: boolean;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
}

function isDeviceService(
  device: DeviceService | DeviceTransport
): device is DeviceService {
  return (
    typeof device === "object" &&
    device !== null &&
    "status" in device &&
    typeof (device as DeviceService).connect === "function"
  );
}

export class MaixPyRuntime extends EventEmitter {
  private _sourceFile: string = "";
  public get sourceFile() {
    return this._sourceFile;
  }

  private runSession?: RunSession;

  constructor(private fileAccessor: FileAccessor) {
    super();
    log("[MaixPyRuntime] created");
  }

  public async start(
    program: string,
    device: DeviceService | DeviceTransport
  ): Promise<void> {
    log(`[MaixPyRuntime] start begin program=${program}`);
    try {
      this.detachSessionOnly();

      const transport = this.resolveTransport(device);
      log(
        `[MaixPyRuntime] transport resolved: ${
          transport
            ? `ip=${transport.ip} isConnected=${transport.isConnected} isRunning=${transport.isRunning} hasRunCode=${typeof transport.runCode === "function"}`
            : "undefined"
        }`
      );

      if (!transport) {
        const msg = "Device transport is missing (not connected?)";
        logError(`[MaixPyRuntime] ${msg}`);
        this.sendEvent("output", "err", msg);
        this.sendEvent("end");
        return;
      }

      if (!transport.isConnected) {
        const msg = `Device transport not connected (ip=${transport.ip})`;
        logError(`[MaixPyRuntime] ${msg}`);
        this.sendEvent("output", "err", msg);
        this.sendEvent("end");
        return;
      }

      if (typeof transport.runCode !== "function") {
        const msg =
          "Resolved transport has no runCode(); device object was mis-resolved";
        logError(`[MaixPyRuntime] ${msg}`);
        this.sendEvent("output", "err", msg);
        this.sendEvent("end");
        return;
      }

      if (isDeviceService(device)) {
        log(
          `[MaixPyRuntime] device status=${Status[device.status]} name=${device.device?.name} ip=${device.device?.ip}`
        );
        if (device.status === Status.offline) {
          const msg = "Device status is offline";
          logError(`[MaixPyRuntime] ${msg}`);
          this.sendEvent("output", "err", msg);
          this.sendEvent("end");
          return;
        }
      }

      let resolved: ResolvedSource;
      try {
        resolved = resolveSourceForRun(program);
      } catch (e) {
        const msg = `Cannot resolve source for '${program}': ${formatUnknown(e)}`;
        logError(`[MaixPyRuntime] ${msg}`);
        this.sendEvent("output", "err", msg);
        this.sendEvent("end");
        return;
      }

      this._sourceFile = resolved.label;
      log(
        `[MaixPyRuntime] resolved source label=${resolved.label} fsPath=${resolved.fsPath ?? "n/a"} hasInline=${resolved.content !== undefined}`
      );

      let sourceFile: Uint8Array;
      try {
        sourceFile = await readResolvedSource(resolved, (p) =>
          this.fileAccessor.readFile(p)
        );
      } catch (e) {
        const msg = `Source file not found or unreadable: ${resolved.label}\n${formatUnknown(e)}`;
        logError(`[MaixPyRuntime] ${msg}`);
        this.sendEvent("output", "err", msg);
        this.sendEvent("end");
        return;
      }

      if (!sourceFile || sourceFile.byteLength === 0) {
        const msg = `Source file empty: ${resolved.label}`;
        logError(`[MaixPyRuntime] ${msg}`);
        this.sendEvent("output", "err", msg);
        this.sendEvent("end");
        return;
      }

      if (this.runSession) {
        warn("[MaixPyRuntime] stopping previous RunSession before new start");
        try {
          this.runSession.stop();
        } catch (e) {
          logError(`[MaixPyRuntime] previous stop failed: ${formatUnknown(e)}`);
        }
        this.runSession.dispose();
        this.runSession = undefined;
      }

      const code = new TextDecoder("utf-8").decode(sourceFile);
      log(
        `[MaixPyRuntime] sending code (${code.length} chars, ${sourceFile.byteLength} bytes) -> ${transport.ip}`
      );
      this.sendEvent(
        "output",
        "out",
        `[MaixCode] Running ${resolved.label} on ${transport.ip} (${code.length} chars)\n`
      );

      const session = new RunSession(transport);
      this.runSession = session;

      session.start(code, {
        onOutput: (text) => {
          log(`[MaixPyRuntime] device output: ${String(text).slice(0, 300)}`);
          this.sendEvent("output", "out", text);
        },
        onError: (msg) => {
          logError(`[MaixPyRuntime] device error: ${msg}`);
          this.sendEvent("output", "err", msg);
        },
        onEnd: () => {
          log("[MaixPyRuntime] session end");
          if (this.runSession === session) {
            this.runSession = undefined;
          }
          this.sendEvent("end");
        },
        onImg: (data) => {
          this.sendEvent("img", data);
        },
      });

      log("[MaixPyRuntime] start finished (code dispatched)");
    } catch (e) {
      const msg = `MaixPyRuntime.start exception: ${formatUnknown(e)}`;
      logError(msg);
      this.sendEvent("output", "err", msg);
      this.sendEvent("end");
    }
  }

  public stop(): void {
    log("[MaixPyRuntime] stop()");
    try {
      this.runSession?.stop();
    } catch (e) {
      logError(`[MaixPyRuntime] stop failed: ${formatUnknown(e)}`);
    }
  }

  public dispose(): void {
    log("[MaixPyRuntime] dispose()");
    try {
      if (this.runSession) {
        this.runSession.stop();
        this.runSession.dispose();
        this.runSession = undefined;
      }
    } catch (e) {
      logError(`[MaixPyRuntime] dispose failed: ${formatUnknown(e)}`);
    }
  }

  private detachSessionOnly() {
    if (this.runSession) {
      log("[MaixPyRuntime] detachSessionOnly()");
      try {
        this.runSession.dispose();
      } catch (e) {
        logError(`[MaixPyRuntime] detach failed: ${formatUnknown(e)}`);
      }
      this.runSession = undefined;
    }
  }

  private resolveTransport(
    device: DeviceService | DeviceTransport
  ): DeviceTransport | undefined {
    try {
      if (isDeviceService(device)) {
        const t = device.transport ?? device.wss;
        log(
          `[MaixPyRuntime] resolveTransport DeviceService transport=${!!device.transport} wss=${!!device.wss} resolved=${!!t}`
        );
        return t;
      }
      log("[MaixPyRuntime] resolveTransport bare DeviceTransport");
      return device;
    } catch (e) {
      logError(`[MaixPyRuntime] resolveTransport failed: ${formatUnknown(e)}`);
      return undefined;
    }
  }

  private sendEvent(event: string, ...args: any[]): void {
    setTimeout(() => {
      try {
        this.emit(event, ...args);
      } catch (e) {
        logError(`[MaixPyRuntime] emit(${event}) failed: ${formatUnknown(e)}`);
      }
    }, 0);
  }
}
