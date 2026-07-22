import { DeviceTransport } from "../ports/device_transport";
import { error, formatUnknown, log, warn } from "../logger";

export type RunSessionHandlers = {
  onOutput?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
  onImg?: (data: ArrayBuffer) => void;
};

/**
 * One code execution on a connected transport.
 * Always dispose() to remove listeners (avoids stacking on repeated Run).
 */
export class RunSession {
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly transport: DeviceTransport) {
    log(`[RunSession] created for ${transport.ip}`);
  }

  public start(code: string, handlers: RunSessionHandlers = {}): void {
    if (this.disposed) {
      warn("[RunSession] start() called after dispose — ignored");
      return;
    }

    log(
      `[RunSession] start codeLength=${code.length} isConnected=${this.transport.isConnected}`
    );

    const onOutput = (text: string) => {
      if (!this.disposed) {
        handlers.onOutput?.(text);
      }
    };
    const onRunAck = (content: Uint8Array) => {
      if (this.disposed) {
        return;
      }
      const ok = content[0] === 1;
      log(`[RunSession] runAck success=${ok} raw[0]=${content[0]}`);
      if (!ok) {
        handlers.onError?.(
          "Failed to run code, return " + Buffer.from(content).toString()
        );
      } else {
        handlers.onOutput?.("[MaixCode] Device accepted run (RunAck)\n");
      }
    };
    const onError = (err: unknown) => {
      if (this.disposed) {
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : (err as { msg?: string })?.msg || formatUnknown(err);
      error(`[RunSession] transport error: ${msg}`);
      handlers.onError?.(msg);
      handlers.onEnd?.();
      this.dispose();
    };
    const onFinish = (rsp?: { code?: number; msg?: string }) => {
      if (this.disposed) {
        return;
      }
      log(`[RunSession] finish ${formatUnknown(rsp)}`);
      if (rsp?.msg) {
        handlers.onOutput?.(`[MaixCode] ${rsp.msg}\n`);
      }
      handlers.onEnd?.();
      this.dispose();
    };
    const onClose = (code?: number, reason?: string) => {
      if (this.disposed) {
        return;
      }
      warn(`[RunSession] transport close code=${code} reason=${reason}`);
      handlers.onError?.(
        `Device connection closed (code=${code}, reason=${reason ?? ""})`
      );
      handlers.onEnd?.();
      this.dispose();
    };
    const onImg = (data: ArrayBuffer) => {
      if (!this.disposed) {
        handlers.onImg?.(data);
      }
    };

    try {
      this.transport.on("output", onOutput);
      this.transport.on("runAck", onRunAck);
      this.transport.on("error", onError);
      this.transport.on("finish", onFinish);
      this.transport.on("close", onClose);
      this.transport.on("img", onImg);

      this.cleanups.push(
        () => this.transport.off("output", onOutput),
        () => this.transport.off("runAck", onRunAck),
        () => this.transport.off("error", onError),
        () => this.transport.off("finish", onFinish),
        () => this.transport.off("close", onClose),
        () => this.transport.off("img", onImg)
      );

      log("[RunSession] calling transport.runCode()");
      this.transport.runCode(code);
      log("[RunSession] transport.runCode() returned");
    } catch (e) {
      error(`[RunSession] start failed: ${formatUnknown(e)}`);
      handlers.onError?.(formatUnknown(e));
      handlers.onEnd?.();
      this.dispose();
    }
  }

  public stop(): void {
    if (this.disposed) {
      log("[RunSession] stop() ignored — already disposed");
      return;
    }
    log("[RunSession] stop() -> stopCode()");
    try {
      this.transport.stopCode();
    } catch (e) {
      error(`[RunSession] stopCode failed: ${formatUnknown(e)}`);
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    log("[RunSession] dispose()");
    this.disposed = true;
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (e) {
        // ignore detach errors
      }
    }
    this.cleanups.length = 0;
  }

  public get isDisposed() {
    return this.disposed;
  }
}
