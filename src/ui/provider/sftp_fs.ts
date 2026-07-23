import * as vscode from "vscode";
import type { Stats } from "ssh2";
import { ConfigKeys, ConfigSection } from "../../constants";
import { error, formatUnknown, log, warn } from "../../logger";
import {
  compileSftpHidePatterns,
  type CompiledSftpFilter,
} from "../../service/ssh/sftp_path_filter";
import type { SftpSession } from "../../service/ssh/sftp_session";

export type SftpMount = {
  /** authority in URI (device key) */
  authority: string;
  host: string;
  port: number;
  timeoutMs: number;
  credentials: import("../../service/ssh/types").SshCredential[];
  /** remote root shown as workspace folder path */
  remoteRoot: string;
  deviceName?: string;
  session: SftpSession;
  filter: CompiledSftpFilter;
  readOnly: boolean;
};

/**
 * Virtual FS for device SFTP.
 * URI: maixsftp://<authority>/absolute/remote/path
 */
export class SftpFileSystemProvider implements vscode.FileSystemProvider {
  static readonly scheme = "maixsftp";

  private readonly mounts = new Map<string, SftpMount>();
  private readonly _emitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._emitter.event;

  registerMount(mount: SftpMount): void {
    this.mounts.set(mount.authority, mount);
    log(
      `[SFTP] mount authority=${mount.authority} host=${mount.host} root=${mount.remoteRoot}`
    );
  }

  unregisterMount(authority: string): void {
    const m = this.mounts.get(authority);
    if (m) {
      m.session.dispose();
      this.mounts.delete(authority);
      log(`[SFTP] unmount authority=${authority}`);
    }
  }

  getMount(authority: string): SftpMount | undefined {
    return this.mounts.get(authority);
  }

  listMounts(): SftpMount[] {
    return [...this.mounts.values()];
  }

  /** Refresh hide patterns / readOnly from settings for all mounts */
  reloadFiltersFromConfig(): void {
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const patterns = cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []);
    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    const filter = compileSftpHidePatterns(patterns);
    for (const m of this.mounts.values()) {
      m.filter = filter;
      m.readOnly = readOnly;
    }
  }

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { mount, remotePath } = await this.resolve(uri);
    try {
      const st = await mount.session.stat(remotePath);
      return statsToFileStat(st, mount.readOnly);
    } catch (e) {
      throw mapSftpError(e, uri);
    }
  }

  async readDirectory(
    uri: vscode.Uri
  ): Promise<[string, vscode.FileType][]> {
    const { mount, remotePath } = await this.resolve(uri);
    try {
      const list = await mount.session.readdir(remotePath);
      const out: [string, vscode.FileType][] = [];
      for (const ent of list) {
        const name = ent.filename;
        if (name === "." || name === "..") {
          continue;
        }
        const childPath =
          remotePath === "/"
            ? `/${name}`
            : `${remotePath.replace(/\/$/, "")}/${name}`;
        if (mount.filter.shouldHide(childPath, name)) {
          continue;
        }
        const attrs = ent.attrs;
        // ssh2 Attributes: use mode bits (S_IFMT)
        const mode = attrs?.mode ?? 0;
        const ifmt = mode & 0o170000;
        let type = vscode.FileType.File;
        if (ifmt === 0o040000) {
          type = vscode.FileType.Directory;
        } else if (ifmt === 0o120000) {
          type = vscode.FileType.SymbolicLink;
        }
        out.push([name, type]);
      }
      out.sort((a, b) => {
        if (a[1] !== b[1]) {
          return a[1] === vscode.FileType.Directory ? -1 : 1;
        }
        return a[0].localeCompare(b[0]);
      });
      return out;
    } catch (e) {
      throw mapSftpError(e, uri);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { mount, remotePath } = await this.resolve(uri);
    try {
      const buf = await mount.session.readFile(remotePath);
      return new Uint8Array(buf);
    } catch (e) {
      throw mapSftpError(e, uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const { mount, remotePath } = await this.resolve(uri);
    this.assertWritable(mount, uri);
    try {
      let exists = false;
      try {
        await mount.session.stat(remotePath);
        exists = true;
      } catch {
        exists = false;
      }
      if (!exists && !options.create) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (exists && !options.overwrite) {
        throw vscode.FileSystemError.FileExists(uri);
      }
      // ensure parent exists when creating
      if (!exists && options.create) {
        const parent = parentRemotePath(remotePath);
        if (parent) {
          try {
            await mount.session.stat(parent);
          } catch {
            throw vscode.FileSystemError.FileNotFound(
              uri.with({ path: parent })
            );
          }
        }
      }
      await mount.session.writeFile(remotePath, Buffer.from(content));
      this._emitter.fire([
        {
          type: exists
            ? vscode.FileChangeType.Changed
            : vscode.FileChangeType.Created,
          uri,
        },
      ]);
    } catch (e) {
      if (e instanceof vscode.FileSystemError) {
        throw e;
      }
      throw mapSftpError(e, uri);
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const { mount, remotePath } = await this.resolve(uri);
    this.assertWritable(mount, uri);
    try {
      await mount.session.mkdir(remotePath);
      this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    } catch (e) {
      throw mapSftpError(e, uri);
    }
  }

  async delete(
    uri: vscode.Uri,
    options: { recursive: boolean }
  ): Promise<void> {
    const { mount, remotePath } = await this.resolve(uri);
    this.assertWritable(mount, uri);
    try {
      if (options.recursive) {
        await mount.session.rmRecursive(remotePath);
      } else {
        const st = await mount.session.stat(remotePath);
        if (st.isDirectory()) {
          await mount.session.rmdir(remotePath);
        } else {
          await mount.session.unlink(remotePath);
        }
      }
      this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    } catch (e) {
      throw mapSftpError(e, uri);
    }
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    const oldR = await this.resolve(oldUri);
    const newR = await this.resolve(newUri);
    if (oldR.mount.authority !== newR.mount.authority) {
      throw vscode.FileSystemError.Unavailable(
        "Cross-device rename is not supported"
      );
    }
    this.assertWritable(oldR.mount, oldUri);
    try {
      let destExists = false;
      try {
        await newR.mount.session.stat(newR.remotePath);
        destExists = true;
      } catch {
        destExists = false;
      }
      if (destExists) {
        if (!options.overwrite) {
          throw vscode.FileSystemError.FileExists(newUri);
        }
        await newR.mount.session.rmRecursive(newR.remotePath);
      }
      await oldR.mount.session.rename(oldR.remotePath, newR.remotePath);
      this._emitter.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri },
      ]);
    } catch (e) {
      if (e instanceof vscode.FileSystemError) {
        throw e;
      }
      throw mapSftpError(e, newUri);
    }
  }

  async copy(
    source: vscode.Uri,
    destination: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    const src = await this.resolve(source);
    const dst = await this.resolve(destination);
    this.assertWritable(dst.mount, destination);
    try {
      let destExists = false;
      try {
        await dst.mount.session.stat(dst.remotePath);
        destExists = true;
      } catch {
        destExists = false;
      }
      if (destExists && !options.overwrite) {
        throw vscode.FileSystemError.FileExists(destination);
      }
      const st = await src.mount.session.stat(src.remotePath);
      if (st.isDirectory()) {
        await this.copyDir(src.mount, src.remotePath, dst.mount, dst.remotePath);
      } else {
        const data = await src.mount.session.readFile(src.remotePath);
        if (destExists) {
          await dst.mount.session.unlink(dst.remotePath);
        }
        await dst.mount.session.writeFile(dst.remotePath, data);
      }
      this._emitter.fire([
        { type: vscode.FileChangeType.Created, uri: destination },
      ]);
    } catch (e) {
      if (e instanceof vscode.FileSystemError) {
        throw e;
      }
      throw mapSftpError(e, destination);
    }
  }

  dispose(): void {
    for (const a of [...this.mounts.keys()]) {
      this.unregisterMount(a);
    }
    this._emitter.dispose();
  }

  private async copyDir(
    srcMount: SftpMount,
    srcPath: string,
    dstMount: SftpMount,
    dstPath: string
  ): Promise<void> {
    try {
      await dstMount.session.mkdir(dstPath);
    } catch {
      // may already exist
    }
    const list = await srcMount.session.readdir(srcPath);
    for (const ent of list) {
      const name = ent.filename;
      if (name === "." || name === "..") {
        continue;
      }
      const sChild =
        srcPath === "/"
          ? `/${name}`
          : `${srcPath.replace(/\/$/, "")}/${name}`;
      const dChild =
        dstPath === "/"
          ? `/${name}`
          : `${dstPath.replace(/\/$/, "")}/${name}`;
      const st = await srcMount.session.stat(sChild);
      if (st.isDirectory()) {
        await this.copyDir(srcMount, sChild, dstMount, dChild);
      } else {
        const data = await srcMount.session.readFile(sChild);
        await dstMount.session.writeFile(dChild, data);
      }
    }
  }

  private assertWritable(mount: SftpMount, uri: vscode.Uri): void {
    if (mount.readOnly) {
      throw vscode.FileSystemError.NoPermissions(
        `SFTP is read-only (${uri.toString()})`
      );
    }
  }

  private async resolve(
    uri: vscode.Uri
  ): Promise<{ mount: SftpMount; remotePath: string }> {
    if (uri.scheme !== SftpFileSystemProvider.scheme) {
      throw vscode.FileSystemError.Unavailable(uri);
    }
    const authority = uri.authority;
    const mount = this.mounts.get(authority);
    if (!mount) {
      throw vscode.FileSystemError.Unavailable(
        `No SFTP mount for ${authority}. Open device files first.`
      );
    }
    try {
      if (!mount.session.isConnected) {
        await mount.session.ensureConnected({
          host: mount.host,
          port: mount.port,
          timeoutMs: mount.timeoutMs,
          credentials: mount.credentials,
          onProgress: (line) => log(`[SFTP] ${line}`),
        });
      }
    } catch (e) {
      error(`[SFTP] connect failed: ${formatUnknown(e)}`);
      throw vscode.FileSystemError.Unavailable(
        `SFTP connect failed: ${formatUnknown(e)}`
      );
    }
    const remotePath = uriPathToRemote(uri.path);
    return { mount, remotePath };
  }
}

export function buildSftpUri(authority: string, remotePath: string): vscode.Uri {
  const p = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  return vscode.Uri.from({
    scheme: SftpFileSystemProvider.scheme,
    authority,
    path: p,
  });
}

function uriPathToRemote(path: string): string {
  if (!path || path === "/") {
    return "/";
  }
  // VS Code may encode; path is usually decoded
  let p = path.replace(/\\/g, "/");
  if (!p.startsWith("/")) {
    p = "/" + p;
  }
  // block escape
  const parts = p.split("/").filter((s) => s.length > 0 && s !== ".");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length ? "/" + stack.join("/") : "/";
}

function parentRemotePath(remotePath: string): string | undefined {
  if (!remotePath || remotePath === "/") {
    return undefined;
  }
  const i = remotePath.lastIndexOf("/");
  if (i <= 0) {
    return "/";
  }
  return remotePath.slice(0, i) || "/";
}

function statsToFileStat(st: Stats, readOnly: boolean): vscode.FileStat {
  let type = vscode.FileType.File;
  if (st.isDirectory()) {
    type = vscode.FileType.Directory;
  } else if (st.isSymbolicLink()) {
    type = vscode.FileType.SymbolicLink;
  }
  const ctime = (st.atime || 0) * 1000;
  const mtime = (st.mtime || 0) * 1000;
  return {
    type,
    ctime,
    mtime,
    size: st.size ?? 0,
    permissions: readOnly ? vscode.FilePermission.Readonly : undefined,
  };
}

function mapSftpError(e: unknown, uri: vscode.Uri): Error {
  if (e instanceof vscode.FileSystemError) {
    return e;
  }
  const err = e as NodeJS.ErrnoException & { code?: string | number };
  const code = String(err.code ?? err.message ?? "");
  const msg = (err.message || "").toLowerCase();
  warn(`[SFTP] error ${uri.toString()}: ${formatUnknown(e)}`);
  if (
    code === "2" ||
    code === "ENOENT" ||
    msg.includes("no such file") ||
    msg.includes("not found")
  ) {
    return vscode.FileSystemError.FileNotFound(uri);
  }
  if (
    code === "13" ||
    code === "EACCES" ||
    msg.includes("permission") ||
    msg.includes("denied")
  ) {
    return vscode.FileSystemError.NoPermissions(uri);
  }
  if (code === "17" || code === "EEXIST" || msg.includes("exists")) {
    return vscode.FileSystemError.FileExists(uri);
  }
  return vscode.FileSystemError.Unavailable(
    `${uri.toString()}: ${formatUnknown(e)}`
  );
}
