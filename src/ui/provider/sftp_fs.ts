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
  /** When true, filtered entries still appear (for badges / unfilter). */
  showFiltered: boolean;
};

/**
 * Virtual FS for device SFTP.
 * URI: maixsftp://<authority>/absolute/remote/path
 */
export type EnsureSftpMount = (
  authority: string
) => Promise<SftpMount | undefined>;

export class SftpFileSystemProvider implements vscode.FileSystemProvider {
  static readonly scheme = "maixsftp";

  private readonly mounts = new Map<string, SftpMount>();
  private readonly _emitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._emitter.event;

  /**
   * Called when Explorer hits a maixsftp URI with no in-memory mount
   * (typical after window reload). Wired by SftpService.
   */
  ensureMount: EnsureSftpMount | undefined;

  private remountInFlight = new Map<string, Promise<SftpMount | undefined>>();

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
    this.applyFilterState({
      patterns: cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []) || [],
      readOnly: cfg.get<boolean>(ConfigKeys.sftpReadOnly, false),
      showFiltered: cfg.get<boolean>(ConfigKeys.sftpShowFiltered, false),
    });
  }

  /**
   * Apply filter state immediately (without waiting for configuration event)
   * and force Explorer + decorations consumers to refresh.
   */
  applyFilterState(state: {
    patterns: string[];
    readOnly?: boolean;
    showFiltered?: boolean;
  }): void {
    const filter = compileSftpHidePatterns(state.patterns);
    for (const m of this.mounts.values()) {
      m.filter = filter;
      if (typeof state.readOnly === "boolean") {
        m.readOnly = state.readOnly;
      }
      if (typeof state.showFiltered === "boolean") {
        m.showFiltered = state.showFiltered;
      }
    }
    this.notifyExplorerRefresh(true);
  }

  /**
   * Force Explorer to re-read directories for all mounts.
   * @param aggressive also pulse workspace roots and re-fire after a tick
   *   (VS Code sometimes ignores a single Changed on virtual FS roots).
   */
  notifyExplorerRefresh(aggressive = false): void {
    const events = this.collectRootChangeEvents();
    if (events.length) {
      this._emitter.fire(events);
    }
    if (aggressive) {
      // Second pulse: Explorer often caches dir listings until another event.
      setTimeout(() => {
        const again = this.collectRootChangeEvents();
        if (again.length) {
          this._emitter.fire(again);
        }
      }, 30);
      setTimeout(() => {
        const again = this.collectRootChangeEvents();
        if (again.length) {
          this._emitter.fire(again);
        }
      }, 120);
    }
  }

  /**
   * Refresh one path so Explorer re-runs readDirectory/stat.
   * kind:
   * - hide: emit Deleted (item vanishes when showFiltered is false)
   * - show: emit Created (item reappears)
   * - change / default: emit Changed
   */
  refreshUri(
    uri?: vscode.Uri,
    kind: "hide" | "show" | "change" = "change"
  ): void {
    if (!uri) {
      this.notifyExplorerRefresh(true);
      return;
    }
    if (uri.scheme !== SftpFileSystemProvider.scheme) {
      return;
    }
    const remote = uriPathToRemote(uri.path);
    const events: vscode.FileChangeEvent[] = [];

    if (kind === "hide") {
      events.push({ type: vscode.FileChangeType.Deleted, uri });
    } else if (kind === "show") {
      events.push({ type: vscode.FileChangeType.Created, uri });
    } else {
      events.push({ type: vscode.FileChangeType.Changed, uri });
    }

    // All ancestors must re-list so hide/show is visible without collapsing.
    for (const ancestor of ancestorRemotePaths(remote)) {
      events.push({
        type: vscode.FileChangeType.Changed,
        uri: buildSftpUri(uri.authority, ancestor),
      });
    }

    const mount = this.mounts.get(uri.authority);
    if (mount) {
      events.push({
        type: vscode.FileChangeType.Changed,
        uri: buildSftpUri(mount.authority, mount.remoteRoot),
      });
    }

    // Workspace folder root (may differ from remoteRoot path string form)
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (
        f.uri.scheme === SftpFileSystemProvider.scheme &&
        f.uri.authority === uri.authority
      ) {
        events.push({ type: vscode.FileChangeType.Changed, uri: f.uri });
      }
    }

    this._emitter.fire(events);
    setTimeout(() => this._emitter.fire(events), 30);
    setTimeout(() => this._emitter.fire(events), 120);
  }

  private collectRootChangeEvents(): vscode.FileChangeEvent[] {
    const events: vscode.FileChangeEvent[] = [];
    const seen = new Set<string>();
    const push = (uri: vscode.Uri) => {
      const k = uri.toString();
      if (seen.has(k)) {
        return;
      }
      seen.add(k);
      events.push({ type: vscode.FileChangeType.Changed, uri });
    };

    for (const m of this.mounts.values()) {
      push(buildSftpUri(m.authority, m.remoteRoot));
      push(buildSftpUri(m.authority, "/"));
    }
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (f.uri.scheme === SftpFileSystemProvider.scheme) {
        push(f.uri);
      }
    }
    return events;
  }

  getFilterMatch(uri: vscode.Uri): string | undefined {
    const mount = this.mounts.get(uri.authority);
    if (!mount) {
      return undefined;
    }
    const remotePath = uriPathToRemote(uri.path);
    const basename = remotePath.split("/").filter(Boolean).pop() || remotePath;
    return mount.filter.matchPattern(remotePath, basename);
  }

  remotePathOf(uri: vscode.Uri): string {
    return uriPathToRemote(uri.path);
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
      const { stats, isLink, linkTarget } =
        await mount.session.statPreferFollow(remotePath);
      // Directory|SymbolicLink so Explorer can expand symlink dirs (e.g. /sbin)
      return statsToFileStat(stats, mount.readOnly, {
        isSymlink: isLink,
        linkTarget,
      });
    } catch (e) {
      throw mapSftpError(e, uri);
    }
  }

  async readDirectory(
    uri: vscode.Uri
  ): Promise<[string, vscode.FileType][]> {
    const { mount, remotePath } = await this.resolve(uri);
    try {
      // Fast path: readdir as-is (1 RTT). Only on Failure resolve symlink target.
      let list;
      try {
        list = await mount.session.readdir(remotePath);
      } catch {
        const listPath =
          await mount.session.resolveForListOnError(remotePath);
        list = await mount.session.readdir(listPath);
      }

      type Pending = {
        name: string;
        childPath: string;
        type: vscode.FileType;
        needProbe: boolean;
      };
      const pending: Pending[] = [];
      for (const ent of list) {
        const name = ent.filename;
        if (name === "." || name === "..") {
          continue;
        }
        const childPath =
          remotePath === "/"
            ? `/${name}`
            : `${remotePath.replace(/\/$/, "")}/${name}`;
        if (
          mount.filter.shouldHide(childPath, name) &&
          !mount.showFiltered
        ) {
          continue;
        }
        const { type, needProbe } = entryTypeFromAttrs(ent.attrs?.mode);
        pending.push({ name, childPath, type, needProbe });
      }

      // Probe symlink targets in parallel (bounded), not serially.
      const probes = pending.filter((p) => p.needProbe);
      if (probes.length) {
        const CONCURRENCY = 8;
        for (let i = 0; i < probes.length; i += CONCURRENCY) {
          const batch = probes.slice(i, i + CONCURRENCY);
          const types = await Promise.all(
            batch.map((p) => mount.session.probeSymlinkType(p.childPath))
          );
          for (let j = 0; j < batch.length; j++) {
            batch[j].type = types[j] as vscode.FileType;
          }
        }
      }

      const out: [string, vscode.FileType][] = pending.map((p) => [
        p.name,
        p.type,
      ]);
      out.sort((a, b) => {
        const aDir = (a[1] & vscode.FileType.Directory) !== 0;
        const bDir = (b[1] & vscode.FileType.Directory) !== 0;
        if (aDir !== bDir) {
          return aDir ? -1 : 1;
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
        await mount.session.lstat(remotePath);
        exists = true;
      } catch {
        try {
          await mount.session.stat(remotePath);
          exists = true;
        } catch {
          exists = false;
        }
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
    let mount = this.mounts.get(authority);
    if (!mount) {
      mount = await this.tryEnsureMount(authority);
    }
    if (!mount) {
      throw vscode.FileSystemError.Unavailable(
        `No SFTP mount for ${authority}. Reconnect device or Open Device Files (SFTP).`
      );
    }
    try {
      if (!mount.session.isConnected) {
        // Session may have been reset after drop; reconnect in place
        await mount.session.ensureConnected({
          host: mount.host,
          port: mount.port,
          timeoutMs: mount.timeoutMs,
          credentials: mount.credentials,
          onProgress: (line) => log(`[SFTP] ${line}`),
        });
      }
    } catch (e) {
      // Session may be disposed after hard failure — rebuild via ensureMount
      warn(
        `[SFTP] reconnect failed for ${authority}, remounting: ${formatUnknown(e)}`
      );
      this.unregisterMount(authority);
      mount = await this.tryEnsureMount(authority);
      if (!mount || !mount.session.isConnected) {
        error(`[SFTP] connect failed: ${formatUnknown(e)}`);
        throw vscode.FileSystemError.Unavailable(
          `SFTP connect failed: ${formatUnknown(e)}`
        );
      }
    }
    const remotePath = uriPathToRemote(uri.path);
    return { mount, remotePath };
  }

  private async tryEnsureMount(
    authority: string
  ): Promise<SftpMount | undefined> {
    if (!this.ensureMount) {
      return undefined;
    }
    const inflight = this.remountInFlight.get(authority);
    if (inflight) {
      return inflight;
    }
    const p = this.ensureMount(authority)
      .catch((e) => {
        warn(`[SFTP] ensureMount ${authority}: ${formatUnknown(e)}`);
        return undefined;
      })
      .finally(() => {
        this.remountInFlight.delete(authority);
      });
    this.remountInFlight.set(authority, p);
    const mount = await p;
    return mount ?? this.mounts.get(authority);
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

/** `/a/b/c` → [`/a/b`, `/a`, `/`] */
function ancestorRemotePaths(remotePath: string): string[] {
  const out: string[] = [];
  let cur: string | undefined = parentRemotePath(remotePath);
  while (cur !== undefined) {
    out.push(cur);
    if (cur === "/") {
      break;
    }
    cur = parentRemotePath(cur);
  }
  return out;
}

function statsToFileStat(
  st: Stats,
  readOnly: boolean,
  opts?: { isSymlink?: boolean; linkTarget?: string }
): vscode.FileStat {
  let type = vscode.FileType.File;
  if (st.isDirectory()) {
    type = vscode.FileType.Directory;
  } else if (st.isFile()) {
    type = vscode.FileType.File;
  } else if (st.isSymbolicLink()) {
    type = vscode.FileType.SymbolicLink;
  } else {
    // mode fallback
    const mode = st.mode ?? 0;
    const ifmt = mode & 0o170000;
    if (ifmt === 0o040000) {
      type = vscode.FileType.Directory;
    } else if (ifmt === 0o120000) {
      type = vscode.FileType.SymbolicLink;
    }
  }
  // Mark as symlink|targetType so Explorer can expand / show link badge
  if (opts?.isSymlink) {
    type = type | vscode.FileType.SymbolicLink;
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

/**
 * Sync type from readdir attrs only (0 RTT).
 * Symlinks marked needProbe for a single followed stat later.
 */
function entryTypeFromAttrs(
  mode: number | undefined
): { type: vscode.FileType; needProbe: boolean } {
  const m = mode ?? 0;
  const ifmt = m & 0o170000;
  if (ifmt === 0o040000) {
    return { type: vscode.FileType.Directory, needProbe: false };
  }
  if (ifmt === 0o100000) {
    return { type: vscode.FileType.File, needProbe: false };
  }
  if (ifmt === 0o120000) {
    // Default File|SymbolicLink until probe upgrades Directory links
    return {
      type: vscode.FileType.File | vscode.FileType.SymbolicLink,
      needProbe: true,
    };
  }
  // Unknown mode: treat as file, optional probe not needed for list speed
  return { type: vscode.FileType.File, needProbe: false };
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
  // ssh2 often surfaces SSH_FX_FAILURE simply as "Failure" for broken links
  // or unsupported ops; treat as FileNotFound so Explorer stays usable.
  if (msg === "failure" || code === "4" || code === "SSH_FX_FAILURE") {
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
