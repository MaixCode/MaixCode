import { Client, type ClientChannel, type ConnectConfig } from "@cweijan/ssh2";
import { EventEmitter } from "vscode";
import type { SshCredential } from "./types";

export type SshConnectOptions = {
  host: string;
  port: number;
  timeoutMs: number;
  credentials: SshCredential[];
  onProgress?: (line: string) => void;
};

/**
 * Single SSH connection + interactive shell stream.
 * Network/host failures abort credential fallback (P2); auth failures try next.
 */
export class SshSession {
  private client: Client | undefined;
  private stream: ClientChannel | undefined;
  private disposed = false;
  private dataEmitter = new EventEmitter<string>();
  private closeEmitter = new EventEmitter<void>();
  private errorEmitter = new EventEmitter<Error>();

  readonly onData = this.dataEmitter.event;
  readonly onClose = this.closeEmitter.event;
  readonly onError = this.errorEmitter.event;

  async connectWithCredentialFallback(
    opts: SshConnectOptions
  ): Promise<{ username: string }> {
    if (!opts.credentials.length) {
      throw new Error("No SSH credentials configured");
    }

    let lastAuthError: Error | undefined;
    for (const cred of opts.credentials) {
      if (this.disposed) {
        throw new Error("SSH session disposed");
      }
      const who = cred.username || "(empty)";
      opts.onProgress?.(`Trying ${who}@${opts.host}...\r\n`);
      try {
        await this.connectOnce(opts.host, opts.port, opts.timeoutMs, cred);
        opts.onProgress?.(`Authenticated as ${who}\r\n`);
        return { username: cred.username };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (isAuthError(err)) {
          lastAuthError = err;
          opts.onProgress?.(`Auth failed for ${who}\r\n`);
          continue;
        }
        if (isNetworkError(err)) {
          throw err;
        }
        throw err;
      }
    }
    throw (
      lastAuthError ?? new Error("No SSH credentials succeeded")
    );
  }

  openShell(dims: { cols: number; rows: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed || !this.client) {
        reject(new Error("SSH not connected"));
        return;
      }
      this.client.shell(
        {
          term: "xterm-256color",
          cols: dims.cols,
          rows: dims.rows,
        },
        (err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          this.stream = stream;
          stream.on("data", (data: Buffer | string) => {
            const text =
              typeof data === "string" ? data : data.toString("utf8");
            this.dataEmitter.fire(text);
          });
          stream.stderr?.on("data", (data: Buffer | string) => {
            const text =
              typeof data === "string" ? data : data.toString("utf8");
            this.dataEmitter.fire(text);
          });
          stream.on("close", () => {
            this.closeEmitter.fire();
          });
          stream.on("error", (e: Error) => {
            this.errorEmitter.fire(e);
          });
          resolve();
        }
      );
    });
  }

  setWindow(cols: number, rows: number): void {
    if (this.stream && !this.disposed) {
      try {
        // @cweijan/ssh2 current typings require string params here.
        this.stream.setWindow(String(rows), String(cols), "0", "0");
      } catch {
        // ignore if stream already closed
      }
    }
  }

  write(data: string): void {
    if (this.stream && !this.disposed) {
      this.stream.write(data);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      this.stream?.close();
    } catch {
      // ignore
    }
    this.stream = undefined;
    try {
      this.client?.end();
    } catch {
      // ignore
    }
    try {
      this.client?.destroy();
    } catch {
      // ignore
    }
    this.client = undefined;
  }

  private connectOnce(
    host: string,
    port: number,
    timeoutMs: number,
    cred: SshCredential
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        client.removeAllListeners();
        if (err) {
          try {
            client.end();
          } catch {
            // ignore
          }
          try {
            client.destroy();
          } catch {
            // ignore
          }
          if (this.client === client) {
            this.client = undefined;
          }
          reject(err);
        } else {
          this.client = client;
          resolve();
        }
      };

      client.on("ready", () => finish());
      client.on("error", (e: Error) => finish(e));

      const config: ConnectConfig = {
        host,
        port,
        username: cred.username,
        password: cred.password ?? "",
        readyTimeout: timeoutMs,
        // Dev convenience for re-flashed boards; MITM risk on untrusted LANs.
        hostVerifier: () => true,
      };

      try {
        client.connect(config);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }
}

export function isAuthError(err: Error): boolean {
  const msg = (err.message || "").toLowerCase();
  const level = (err as { level?: string }).level;
  if (level === "client-authentication") {
    return true;
  }
  return (
    msg.includes("authentication") ||
    msg.includes("all configured authentication methods failed") ||
    msg.includes("permission denied") ||
    msg.includes("auth fail")
  );
}

export function isNetworkError(err: Error): boolean {
  if (isAuthError(err)) {
    return false;
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("host unreachable") ||
    msg.includes("network is unreachable") ||
    msg.includes("getaddrinfo") ||
    msg.includes("connection refused") ||
    msg.includes("connect econn")
  );
}
