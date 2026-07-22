import { DeviceTransport } from "../ports/device_transport";

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

  constructor(private readonly transport: DeviceTransport) {}

  public start(code: string, handlers: RunSessionHandlers = {}): void {
    if (this.disposed) {
      return;
    }

    const onOutput = (text: string) => {
      if (!this.disposed) {
        handlers.onOutput?.(text);
      }
    };
    const onRunAck = (content: Uint8Array) => {
      if (this.disposed) {
        return;
      }
      if (content[0] !== 1) {
        handlers.onError?.(
          "Failed to run code, return " + Buffer.from(content).toString()
        );
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
            : (err as { msg?: string })?.msg || String(err);
      handlers.onError?.(msg);
      handlers.onEnd?.();
      this.dispose();
    };
    const onFinish = () => {
      if (this.disposed) {
        return;
      }
      handlers.onEnd?.();
      this.dispose();
    };
    const onClose = () => {
      if (this.disposed) {
        return;
      }
      handlers.onEnd?.();
      this.dispose();
    };
    const onImg = (data: ArrayBuffer) => {
      if (!this.disposed) {
        handlers.onImg?.(data);
      }
    };

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

    this.transport.runCode(code);
  }

  public stop(): void {
    if (this.disposed) {
      return;
    }
    this.transport.stopCode();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
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
