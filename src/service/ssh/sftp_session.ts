import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import type { FileEntry, Stats } from "ssh2";
import type { SshCredential } from "./types";
import { isAuthError, isNetworkError } from "./ssh_session";

export type SftpConnectOptions = {
  host: string;
  port: number;
  timeoutMs: number;
  credentials: SshCredential[];
  onProgress?: (line: string) => void;
};

/**
 * SSH connection dedicated to SFTP (separate from interactive shell sessions).
 */
export class SftpSession {
  private client: Client | undefined;
  private sftp: SFTPWrapper | undefined;
  private disposed = false;
  private connectPromise: Promise<void> | undefined;

  get isConnected(): boolean {
    return !!this.sftp && !this.disposed;
  }

  async ensureConnected(opts: SftpConnectOptions): Promise<void> {
    if (this.disposed) {
      throw new Error("SFTP session disposed");
    }
    if (this.sftp) {
      return;
    }
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    this.connectPromise = this.connectWithCredentialFallback(opts).finally(
      () => {
        this.connectPromise = undefined;
      }
    );
    await this.connectPromise;
  }

  async connectWithCredentialFallback(
    opts: SftpConnectOptions
  ): Promise<void> {
    if (!opts.credentials.length) {
      throw new Error("No SSH credentials configured");
    }
    let lastAuthError: Error | undefined;
    for (const cred of opts.credentials) {
      if (this.disposed) {
        throw new Error("SFTP session disposed");
      }
      const who = cred.username || "(empty)";
      opts.onProgress?.(`Trying ${who}@${opts.host}...`);
      try {
        await this.connectOnce(opts.host, opts.port, opts.timeoutMs, cred);
        await this.openSftp();
        opts.onProgress?.(`SFTP authenticated as ${who}`);
        return;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.resetClient();
        if (isAuthError(err)) {
          lastAuthError = err;
          opts.onProgress?.(`Auth failed for ${who}`);
          continue;
        }
        if (isNetworkError(err)) {
          throw err;
        }
        throw err;
      }
    }
    throw lastAuthError ?? new Error("No SSH credentials succeeded");
  }

  realpath(remotePath: string): Promise<string> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.realpath(remotePath, (err, abs) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(abs || remotePath);
          });
        })
    );
  }

  stat(remotePath: string): Promise<Stats> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.stat(remotePath, (err, stats) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(stats);
          });
        })
    );
  }

  readdir(remotePath: string): Promise<FileEntry[]> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.readdir(remotePath, (err, list) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(list || []);
          });
        })
    );
  }

  readFile(remotePath: string): Promise<Buffer> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(remotePath);
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("error", reject);
          stream.on("end", () => resolve(Buffer.concat(chunks)));
        })
    );
  }

  writeFile(remotePath: string, data: Buffer): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          const stream = sftp.createWriteStream(remotePath);
          stream.on("error", reject);
          stream.on("close", () => resolve());
          stream.end(data);
        })
    );
  }

  mkdir(remotePath: string): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.mkdir(remotePath, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        })
    );
  }

  unlink(remotePath: string): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.unlink(remotePath, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        })
    );
  }

  rmdir(remotePath: string): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.rmdir(remotePath, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        })
    );
  }

  rename(from: string, to: string): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.rename(from, to, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        })
    );
  }

  async rmRecursive(remotePath: string): Promise<void> {
    const st = await this.stat(remotePath);
    if (st.isDirectory()) {
      const list = await this.readdir(remotePath);
      for (const ent of list) {
        const name = ent.filename;
        if (name === "." || name === "..") {
          continue;
        }
        const child =
          remotePath === "/"
            ? `/${name}`
            : `${remotePath.replace(/\/$/, "")}/${name}`;
        await this.rmRecursive(child);
      }
      await this.rmdir(remotePath);
    } else {
      await this.unlink(remotePath);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.resetClient();
  }

  private async withSftp<T>(fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    if (this.disposed || !this.sftp) {
      throw new Error("SFTP not connected");
    }
    try {
      return await fn(this.sftp);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (
        err?.message?.includes("Not connected") ||
        err?.code === "ECONNRESET"
      ) {
        this.resetClient();
      }
      throw e;
    }
  }

  private openSftp(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error("SSH not connected"));
        return;
      }
      this.client.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }
        this.sftp = sftp;
        sftp.on("close", () => {
          this.sftp = undefined;
        });
        resolve();
      });
    });
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
          client.on("error", () => {
            this.resetClient();
          });
          client.on("end", () => {
            this.resetClient();
          });
          client.on("close", () => {
            this.resetClient();
          });
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
        hostVerifier: () => true,
      };

      try {
        client.connect(config);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private resetClient(): void {
    try {
      this.sftp?.end();
    } catch {
      // ignore
    }
    this.sftp = undefined;
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
}
