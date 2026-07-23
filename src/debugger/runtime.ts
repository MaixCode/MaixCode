import { EventEmitter } from "events";
import { DeviceService } from "../service/device_service";
import { Status } from "../model/status";
import { DeviceTransport } from "../ports/device_transport";
import {
  isCodeAlreadyRunningMessage,
  RunSession,
} from "../service/run_session";
import { error as logError, formatUnknown, log, warn, debug } from "../logger";
import {
  readResolvedSource,
  resolveSourceForRun,
  ResolvedSource,
} from "./source_resolve";
import { WebSocketService } from "../service/websocket_service";

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

function asWebSocketService(
  transport: DeviceTransport
): WebSocketService | undefined {
  if (transport instanceof WebSocketService) {
    return transport;
  }
  if (typeof (transport as WebSocketService).stopAndWait === "function") {
    return transport as WebSocketService;
  }
  return undefined;
}

type FirstAck =
  | { kind: "accepted" }
  | { kind: "busy"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "ended" };

export class MaixPyRuntime extends EventEmitter {
  private _sourceFile: string = "";
  public get sourceFile() {
    return this._sourceFile;
  }

  private runSession?: RunSession;
  private stopping = false;
  /** Suppress TerminatedEvent while we stop+retry the same debug session */
  private suppressEnd = false;

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
        this.failStart("Device transport is missing (not connected?)");
        return;
      }
      if (!transport.isConnected) {
        this.failStart(`Device transport not connected (ip=${transport.ip})`);
        return;
      }
      if (typeof transport.runCode !== "function") {
        this.failStart(
          "Resolved transport has no runCode(); device object was mis-resolved"
        );
        return;
      }

      if (isDeviceService(device)) {
        log(
          `[MaixPyRuntime] device status=${Status[device.status]} name=${device.device?.name} ip=${device.device?.ip}`
        );
        if (device.status === Status.offline) {
          this.failStart("Device status is offline");
          return;
        }
      }

      let resolved: ResolvedSource;
      try {
        resolved = resolveSourceForRun(program);
      } catch (e) {
        this.failStart(
          `Cannot resolve source for '${program}': ${formatUnknown(e)}`
        );
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
        this.failStart(
          `Source file not found or unreadable: ${resolved.label}\n${formatUnknown(e)}`
        );
        return;
      }

      if (!sourceFile || sourceFile.byteLength === 0) {
        this.failStart(`Source file empty: ${resolved.label}`);
        return;
      }

      const code = new TextDecoder("utf-8").decode(sourceFile);

      // Proactive stop when device already reports running
      if (transport.isRunning) {
        log("[MaixPyRuntime] device already running — stop then run");
        this.sendEvent(
          "output",
          "out",
          "[MaixCode] Device is already running; stopping previous script...\n"
        );
        await this.stopDevice(transport);
        await delay(150);
      }

      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const ack = await this.dispatchRunOnce(
          transport,
          code,
          resolved.label,
          attempt
        );
        log(`[MaixPyRuntime] attempt ${attempt} firstAck=${ack.kind}`);

        if (ack.kind === "accepted") {
          // Session stays open until finish / user stop
          log("[MaixPyRuntime] run accepted; waiting for device finish/stop");
          return;
        }

        if (ack.kind === "busy" && attempt < maxAttempts) {
          this.sendEvent(
            "output",
            "out",
            `[MaixCode] ${ack.message}\n[MaixCode] Stopping previous script and retrying...\n`
          );
          this.suppressEnd = true;
          this.detachSessionOnly();
          await this.stopDevice(transport);
          await delay(250);
          this.suppressEnd = false;
          continue;
        }

        if (ack.kind === "busy") {
          this.sendEvent(
            "output",
            "err",
            `[MaixCode] ${ack.message}\n[MaixCode] Still busy after stop+retry. Press Stop, then Run again.\n`
          );
          this.detachSessionOnly();
          this.sendEvent("end");
          return;
        }

        if (ack.kind === "failed") {
          this.sendEvent("output", "err", ack.message + "\n");
          this.detachSessionOnly();
          this.sendEvent("end");
          return;
        }

        // ended immediately (script finished very fast or error end)
        log("[MaixPyRuntime] run ended during first-ack wait");
        return;
      }
    } catch (e) {
      const msg = `MaixPyRuntime.start exception: ${formatUnknown(e)}`;
      logError(msg);
      this.sendEvent("output", "err", msg);
      this.sendEvent("end");
    }
  }

  /**
   * Run a project zip via RunProject (cmd 18). Same busy/retry lifecycle as start().
   */
  public async startProject(
    zipData: Buffer,
    device: DeviceService | DeviceTransport,
    label = "project.zip"
  ): Promise<void> {
    log(`[MaixPyRuntime] startProject begin bytes=${zipData.length} label=${label}`);
    try {
      this.detachSessionOnly();

      const transport = this.resolveTransport(device);
      if (!transport) {
        this.failStart("Device transport is missing (not connected?)");
        return;
      }
      if (!transport.isConnected) {
        this.failStart(`Device transport not connected (ip=${transport.ip})`);
        return;
      }
      if (typeof transport.runProject !== "function") {
        this.failStart("Device transport does not support runProject");
        return;
      }
      if (!zipData?.length) {
        this.failStart("Project zip is empty");
        return;
      }

      this._sourceFile = label;

      if (transport.isRunning) {
        log("[MaixPyRuntime] device already running — stop then run project");
        this.sendEvent(
          "output",
          "out",
          "[MaixCode] Device is already running; stopping previous script...\n"
        );
        await this.stopDevice(transport);
        await delay(150);
      }

      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const ack = await this.dispatchProjectOnce(
          transport,
          zipData,
          label,
          attempt
        );
        log(`[MaixPyRuntime] project attempt ${attempt} firstAck=${ack.kind}`);

        if (ack.kind === "accepted") {
          log("[MaixPyRuntime] project run accepted; waiting for device finish/stop");
          return;
        }

        if (ack.kind === "busy" && attempt < maxAttempts) {
          this.sendEvent(
            "output",
            "out",
            `[MaixCode] ${ack.message}\n[MaixCode] Stopping previous script and retrying...\n`
          );
          this.suppressEnd = true;
          this.detachSessionOnly();
          await this.stopDevice(transport);
          await delay(250);
          this.suppressEnd = false;
          continue;
        }

        if (ack.kind === "busy") {
          this.sendEvent(
            "output",
            "err",
            `[MaixCode] ${ack.message}\n[MaixCode] Still busy after stop+retry. Press Stop, then Run again.\n`
          );
          this.detachSessionOnly();
          this.sendEvent("end");
          return;
        }

        if (ack.kind === "failed") {
          this.sendEvent("output", "err", ack.message + "\n");
          this.detachSessionOnly();
          this.sendEvent("end");
          return;
        }

        log("[MaixPyRuntime] project run ended during first-ack wait");
        return;
      }
    } catch (e) {
      const msg = `MaixPyRuntime.startProject exception: ${formatUnknown(e)}`;
      logError(msg);
      this.sendEvent("output", "err", msg);
      this.sendEvent("end");
    }
  }

  /**
   * Start a RunSession and wait until first RunAck / busy / end.
   * On accept, leaves session running and resolves; finish later emits "end".
   */
  private dispatchRunOnce(
    transport: DeviceTransport,
    code: string,
    label: string,
    attempt: number
  ): Promise<FirstAck> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ack: FirstAck) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(ack);
      };

      log(
        `[MaixPyRuntime] dispatchRunOnce attempt=${attempt} (${code.length} chars) -> ${transport.ip}`
      );
      this.sendEvent(
        "output",
        "out",
        `[MaixCode] Running ${label} on ${transport.ip} (${code.length} chars)${attempt > 1 ? ` (retry ${attempt})` : ""}\n`
      );

      const session = new RunSession(transport);
      this.runSession = session;

      session.start(code, {
        onOutput: (text) => {
          debug(`[MaixPyRuntime] device output: ${String(text).slice(0, 300)}`);
          this.sendEvent("output", "out", text);
        },
        onError: (msg) => {
          logError(`[MaixPyRuntime] device error: ${msg}`);
          this.sendEvent("output", "err", msg);
          if (!settled && !isCodeAlreadyRunningMessage(msg)) {
            settle({ kind: "failed", message: msg });
          }
        },
        onRunRejected: (msg) => {
          log(`[MaixPyRuntime] run rejected: ${msg}`);
          this.sendEvent("output", "err", msg + "\n");
          settle({ kind: "busy", message: msg });
        },
        onEnd: () => {
          log("[MaixPyRuntime] session end");
          if (this.runSession === session) {
            this.runSession = undefined;
          }
          if (!settled) {
            settle({ kind: "ended" });
          }
          if (!this.stopping && !this.suppressEnd) {
            this.sendEvent("end");
          }
        },
        onImg: (data) => {
          this.sendEvent("img", data);
        },
      });

      // RunAck success path: listen via transport once
      const onRunAck = (content: Uint8Array) => {
        transport.off("runAck", onRunAck);
        if (content[0] === 1) {
          settle({ kind: "accepted" });
        }
        // failure handled by onRunRejected / onError
      };
      transport.on("runAck", onRunAck);

      // Safety timeout for first ack
      setTimeout(() => {
        transport.off("runAck", onRunAck);
        if (!settled) {
          // No ack yet — assume running (some firmwares slow); keep session
          warn("[MaixPyRuntime] no RunAck within 3s; keeping session open");
          settle({ kind: "accepted" });
        }
      }, 3000);
    });
  }

  private dispatchProjectOnce(
    transport: DeviceTransport,
    zipData: Buffer,
    label: string,
    attempt: number
  ): Promise<FirstAck> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (ack: FirstAck) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(ack);
      };

      log(
        `[MaixPyRuntime] dispatchProjectOnce attempt=${attempt} (${zipData.length} bytes) -> ${transport.ip}`
      );
      this.sendEvent(
        "output",
        "out",
        `[MaixCode] Running project ${label} on ${transport.ip} (${zipData.length} bytes)${attempt > 1 ? ` (retry ${attempt})` : ""}\n`
      );

      const session = new RunSession(transport);
      this.runSession = session;

      session.startProject(zipData, {
        onOutput: (text) => {
          debug(`[MaixPyRuntime] device output: ${String(text).slice(0, 300)}`);
          this.sendEvent("output", "out", text);
        },
        onError: (msg) => {
          logError(`[MaixPyRuntime] device error: ${msg}`);
          this.sendEvent("output", "err", msg);
          if (!settled && !isCodeAlreadyRunningMessage(msg)) {
            settle({ kind: "failed", message: msg });
          }
        },
        onRunRejected: (msg) => {
          log(`[MaixPyRuntime] project run rejected: ${msg}`);
          this.sendEvent("output", "err", msg + "\n");
          settle({ kind: "busy", message: msg });
        },
        onEnd: () => {
          log("[MaixPyRuntime] project session end");
          if (this.runSession === session) {
            this.runSession = undefined;
          }
          if (!settled) {
            settle({ kind: "ended" });
          }
          if (!this.stopping && !this.suppressEnd) {
            this.sendEvent("end");
          }
        },
        onImg: (data) => {
          this.sendEvent("img", data);
        },
      });

      const onRunAck = (content: Uint8Array) => {
        transport.off("runAck", onRunAck);
        if (content[0] === 1) {
          settle({ kind: "accepted" });
        }
      };
      transport.on("runAck", onRunAck);

      setTimeout(() => {
        transport.off("runAck", onRunAck);
        if (!settled) {
          warn("[MaixPyRuntime] no RunAck within 8s for project; keeping session open");
          settle({ kind: "accepted" });
        }
      }, 8000);
    });
  }

  private async stopDevice(transport: DeviceTransport): Promise<void> {
    const ws = asWebSocketService(transport);
    if (ws) {
      const ok = await ws.stopAndWait(4000);
      log(`[MaixPyRuntime] stopDevice stopAndWait ok=${ok}`);
      return;
    }
    try {
      transport.stopCode();
      await delay(300);
    } catch (e) {
      logError(`[MaixPyRuntime] stopDevice failed: ${formatUnknown(e)}`);
    }
  }

  /**
   * User pressed Stop / disconnect: stop device, then end debug session.
   */
  public async requestStop(endSession = true): Promise<void> {
    log(`[MaixPyRuntime] requestStop endSession=${endSession}`);
    this.stopping = true;
    this.suppressEnd = true;
    try {
      const session = this.runSession;
      if (session && !session.isDisposed) {
        // Capture transport via stop on session
        const ok = await session.stopAndWait(4000);
        log(`[MaixPyRuntime] requestStop session.stopAndWait ok=${ok}`);
        session.dispose();
        this.runSession = undefined;
      } else {
        log("[MaixPyRuntime] requestStop: no active RunSession");
      }
    } catch (e) {
      logError(`[MaixPyRuntime] requestStop failed: ${formatUnknown(e)}`);
    } finally {
      this.stopping = false;
      this.suppressEnd = false;
      if (endSession) {
        // Always emit end so debug toolbar closes on first Stop
        this.sendEvent("end");
      }
    }
  }

  public stop(): void {
    void this.requestStop(true);
  }

  public dispose(): void {
    log("[MaixPyRuntime] dispose()");
    try {
      if (this.runSession) {
        this.runSession.dispose();
        this.runSession = undefined;
      }
    } catch (e) {
      logError(`[MaixPyRuntime] dispose failed: ${formatUnknown(e)}`);
    }
  }

  private failStart(msg: string) {
    logError(`[MaixPyRuntime] ${msg}`);
    this.sendEvent("output", "err", msg);
    this.sendEvent("end");
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

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
