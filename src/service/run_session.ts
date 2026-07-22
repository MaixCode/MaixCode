import { DeviceTransport } from "../ports/device_transport";
import { error, formatUnknown, log, warn } from "../logger";

export type RunSessionHandlers = {
  onOutput?: (text: string) => void;
  onError?: (message: string) => void;
  /** Called when the run finishes cleanly or after an unrecoverable failure */
  onEnd?: () => void;
  onImg?: (data: ArrayBuffer) => void;
  /** RunAck failed (device busy, etc.) — not necessarily fatal for the debug session */
  onRunRejected?: (message: string) => void;
};

function errMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  const o = err as { msg?: string; message?: string };
  return o?.msg || o?.message || formatUnknown(err);
}

export function isCodeAlreadyRunningMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("already running") ||
    m.includes("code already") ||
    m.includes("is running") ||
    m.includes("busy")
  );
}

/**
 * One code execution on a connected transport.
 * Always dispose() to remove listeners (avoids stacking on repeated Run).
 */
export class RunSession {
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];
  private stopWaiters: Array<(ok: boolean) => void> = [];

  constructor(private readonly transport: DeviceTransport) {
    log(`[RunSession] created for ${transport.ip}`);
  }

  public start(code: string, handlers: RunSessionHandlers = {}): void {
    if (this.disposed) {
      warn("[RunSession] start() called after dispose — ignored");
      return;
    }

    log(
      `[RunSession] start codeLength=${code.length} isConnected=${this.transport.isConnected} isRunning=${this.transport.isRunning}`
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
      const detail = Buffer.from(content.slice(1)).toString();
      log(`[RunSession] runAck success=${ok} raw[0]=${content[0]} detail=${detail}`);
      if (!ok) {
        const msg =
          detail ||
          "Failed to run code, return " + Buffer.from(content).toString();
        // Busy / already-running is recoverable; do not end the debug session here
        if (isCodeAlreadyRunningMessage(msg)) {
          warn(`[RunSession] run rejected (busy): ${msg}`);
          handlers.onRunRejected?.(msg);
        } else {
          handlers.onError?.(msg);
          // Non-busy run failure still ends the run (not always the WS connection)
          handlers.onEnd?.();
          this.dispose();
        }
      } else {
        handlers.onOutput?.("[MaixCode] Device accepted run (RunAck)\n");
      }
    };
    const onError = (err: unknown) => {
      if (this.disposed) {
        return;
      }
      const msg = errMessage(err);
      // runAck path also emits "error" on failure — treat busy as non-fatal
      if (isCodeAlreadyRunningMessage(msg)) {
        warn(`[RunSession] transport error treated as busy: ${msg}`);
        handlers.onRunRejected?.(msg);
        return;
      }
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
    const onStopAck = (content: Uint8Array) => {
      const ok = content[0] === 1;
      log(`[RunSession] stopAck success=${ok}`);
      this.resolveStopWaiters(ok);
    };
    const onStop = () => {
      log("[RunSession] stop event");
      this.resolveStopWaiters(true);
    };
    const onClose = (code?: number, reason?: string) => {
      if (this.disposed) {
        return;
      }
      warn(`[RunSession] transport close code=${code} reason=${reason}`);
      this.resolveStopWaiters(false);
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
      this.transport.on("stopAck", onStopAck);
      this.transport.on("stop", onStop);
      this.transport.on("close", onClose);
      this.transport.on("img", onImg);

      this.cleanups.push(
        () => this.transport.off("output", onOutput),
        () => this.transport.off("runAck", onRunAck),
        () => this.transport.off("error", onError),
        () => this.transport.off("finish", onFinish),
        () => this.transport.off("stopAck", onStopAck),
        () => this.transport.off("stop", onStop),
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

  /**
   * Send Stop and wait for stopAck/stop/finish (or timeout).
   * Does not dispose listeners — caller decides.
   */
  public stopAndWait(timeoutMs = 3000): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(true);
    }
    log(`[RunSession] stopAndWait timeoutMs=${timeoutMs}`);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        warn("[RunSession] stopAndWait timed out");
        resolve(false);
      }, timeoutMs);

      this.stopWaiters.push((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });

      try {
        this.transport.stopCode();
      } catch (e) {
        error(`[RunSession] stopAndWait stopCode failed: ${formatUnknown(e)}`);
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  private resolveStopWaiters(ok: boolean) {
    const waiters = this.stopWaiters.splice(0, this.stopWaiters.length);
    for (const w of waiters) {
      try {
        w(ok);
      } catch {
        // ignore
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    log("[RunSession] dispose()");
    this.disposed = true;
    this.resolveStopWaiters(false);
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {
        // ignore detach errors
      }
    }
    this.cleanups.length = 0;
  }

  public get isDisposed() {
    return this.disposed;
  }
}
