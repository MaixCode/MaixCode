import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { log, warn } from "../../logger";

export type ExampleFileEntry = {
  type: vscode.FileType;
  data?: Uint8Array;
  ctime: number;
  mtime: number;
  /** Original cached example path on disk (read-only source), if any */
  originFsPath?: string;
  languageId?: string;
};

/**
 * Writable virtual filesystem for MaixCode examples.
 * scheme: example
 * path: /<sourceId>/<relative/path>  (e.g. example://examples/sipeed/basic/hello.py)
 *
 * In-memory map is populated by seedFile when opening from the tree.
 * On restart VS Code restores tabs; missing entries are rehydrated from
 * globalStorage cache/sources/<path> when possible.
 *
 * Save (writeFile) keeps the virtual buffer and prompts Save As.
 */
export class ExampleFileSystemProvider implements vscode.FileSystemProvider {
  static readonly scheme = "example";

  private readonly entries = new Map<string, ExampleFileEntry>();
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  private nextSaveAsShouldPrompt = true;
  /** Absolute path to globalStorage/cache/sources */
  private sourcesRoot: string | undefined;

  constructor(sourcesRoot?: string) {
    if (sourcesRoot) {
      this.sourcesRoot = sourcesRoot;
    }
    const now = Date.now();
    this.entries.set("/", {
      type: vscode.FileType.Directory,
      ctime: now,
      mtime: now,
    });
  }

  setSourcesRoot(sourcesRoot: string): void {
    this.sourcesRoot = sourcesRoot;
    log(`[ExampleFS] sourcesRoot=${sourcesRoot}`);
  }

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const entry = this.ensureEntry(uri);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: entry.type,
      ctime: entry.ctime,
      mtime: entry.mtime,
      size: entry.data?.byteLength ?? 0,
    };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const dirKey = this.keyOf(uri);
    this.ensureEntry(uri);

    // Prefer disk listing when we have a sources root (survives restart)
    const diskDir = this.diskPathForKey(dirKey);
    if (diskDir && fs.existsSync(diskDir) && fs.statSync(diskDir).isDirectory()) {
      try {
        const names = fs.readdirSync(diskDir).filter((n) => !n.startsWith("."));
        const result: [string, vscode.FileType][] = [];
        for (const name of names) {
          const full = path.join(diskDir, name);
          const st = fs.statSync(full);
          result.push([
            name,
            st.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
          ]);
        }
        result.sort((a, b) => {
          if (a[1] !== b[1]) {
            return a[1] === vscode.FileType.Directory ? -1 : 1;
          }
          return a[0].localeCompare(b[0]);
        });
        return result;
      } catch (e) {
        warn(`[ExampleFS] readDirectory disk failed ${diskDir}: ${e}`);
      }
    }

    const dir = this.entries.get(dirKey);
    if (!dir || dir.type !== vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const prefix = dirKey === "/" ? "/" : dirKey + "/";
    const children = new Map<string, vscode.FileType>();

    for (const key of this.entries.keys()) {
      if (key === dirKey || !key.startsWith(prefix)) {
        continue;
      }
      const rest = key.slice(prefix.length);
      if (!rest) {
        continue;
      }
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (children.has(name)) {
        continue;
      }
      if (slash === -1) {
        const child = this.entries.get(prefix + name);
        children.set(name, child?.type ?? vscode.FileType.File);
      } else {
        children.set(name, vscode.FileType.Directory);
      }
    }

    return Array.from(children.entries()).sort((a, b) => {
      if (a[1] !== b[1]) {
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      }
      return a[0].localeCompare(b[0]);
    });
  }

  createDirectory(uri: vscode.Uri): void {
    this.ensureDir(this.keyOf(uri));
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const entry = this.ensureEntry(uri);
    if (!entry || entry.type !== vscode.FileType.File) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (!entry.data) {
      // Retry load from disk
      this.hydrateFromDisk(this.keyOf(uri));
      const again = this.entries.get(this.keyOf(uri));
      if (!again?.data) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      return again.data;
    }
    return entry.data;
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const key = this.keyOf(uri);
    let existing = this.entries.get(key);
    if (!existing) {
      this.hydrateFromDisk(key);
      existing = this.entries.get(key);
    }
    if (!existing && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (existing && existing.type === vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    if (existing && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    this.ensureParentDirs(key);

    const now = Date.now();
    const entry: ExampleFileEntry = {
      type: vscode.FileType.File,
      data: content,
      ctime: existing?.ctime ?? now,
      mtime: now,
      originFsPath: existing?.originFsPath ?? this.diskPathForKey(key),
      languageId: existing?.languageId,
    };
    this.entries.set(key, entry);
    this._emitter.fire([
      {
        type: existing
          ? vscode.FileChangeType.Changed
          : vscode.FileChangeType.Created,
        uri,
      },
    ]);

    log(
      `[ExampleFS] writeFile ${uri.toString()} (${content.byteLength} bytes)`
    );

    if (this.nextSaveAsShouldPrompt) {
      await this.promptSaveAs(uri, content, entry.originFsPath);
    }
  }

  delete(uri: vscode.Uri, options: { recursive: boolean }): void {
    const key = this.keyOf(uri);
    const entry = this.entries.get(key) ?? this.hydrateFromDisk(key);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (entry.type === vscode.FileType.Directory) {
      const prefix = key === "/" ? "/" : key + "/";
      const childKeys = [...this.entries.keys()].filter(
        (k) => k !== key && k.startsWith(prefix)
      );
      if (childKeys.length && !options.recursive) {
        throw vscode.FileSystemError.NoPermissions("Directory is not empty");
      }
      for (const k of childKeys) {
        this.entries.delete(k);
      }
    }
    this.entries.delete(key);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): void {
    const oldKey = this.keyOf(oldUri);
    const newKey = this.keyOf(newUri);
    const entry =
      this.entries.get(oldKey) ?? this.hydrateFromDisk(oldKey) ?? undefined;
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(oldUri);
    }
    if (this.entries.has(newKey) && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(newUri);
    }
    if (entry.type === vscode.FileType.Directory) {
      throw vscode.FileSystemError.NoPermissions(
        "Renaming directories is not supported for example virtual files"
      );
    }
    this.ensureParentDirs(newKey);
    this.entries.delete(oldKey);
    this.entries.set(newKey, { ...entry, mtime: Date.now() });
    this._emitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  seedFile(
    relativePath: string,
    content: string | Uint8Array,
    options?: { originFsPath?: string; languageId?: string }
  ): vscode.Uri {
    const rel = this.normalizeRelative(relativePath);
    const key = "/" + rel;
    const uri = this.uriFromKey(key);
    const data =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
    const now = Date.now();
    this.ensureParentDirs(key);
    const existing = this.entries.get(key);
    this.entries.set(key, {
      type: vscode.FileType.File,
      data,
      ctime: existing?.ctime ?? now,
      mtime: now,
      originFsPath: options?.originFsPath ?? this.diskPathForKey(key),
      languageId: options?.languageId,
    });
    this._emitter.fire([
      {
        type: existing
          ? vscode.FileChangeType.Changed
          : vscode.FileChangeType.Created,
        uri,
      },
    ]);
    log(
      `[ExampleFS] seedFile ${uri.toString()} origin=${options?.originFsPath ?? "-"}`
    );
    return uri;
  }

  getEntry(uri: vscode.Uri): ExampleFileEntry | undefined {
    return this.ensureEntry(uri) ?? undefined;
  }

  getText(uri: vscode.Uri): string | undefined {
    const entry = this.getEntry(uri);
    if (!entry?.data) {
      return undefined;
    }
    return new TextDecoder("utf-8").decode(entry.data);
  }

  getRelativePath(uri: vscode.Uri): string {
    return this.keyOf(uri).replace(/^\//, "");
  }

  async withSilentWrite<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.nextSaveAsShouldPrompt;
    this.nextSaveAsShouldPrompt = false;
    try {
      return await fn();
    } finally {
      this.nextSaveAsShouldPrompt = prev;
    }
  }

  /**
   * Ensure memory entry exists; load from cache/sources when missing.
   * Returns undefined if neither memory nor disk has the path.
   */
  private ensureEntry(uri: vscode.Uri): ExampleFileEntry | undefined {
    const key = this.keyOf(uri);
    const existing = this.entries.get(key);
    if (existing && (existing.type === vscode.FileType.Directory || existing.data)) {
      return existing;
    }
    return this.hydrateFromDisk(key) ?? existing;
  }

  private hydrateFromDisk(key: string): ExampleFileEntry | undefined {
    if (key === "/") {
      return this.entries.get("/");
    }
    const diskPath = this.diskPathForKey(key);
    if (!diskPath || !fs.existsSync(diskPath)) {
      log(`[ExampleFS] hydrate miss key=${key} disk=${diskPath ?? "n/a"}`);
      return undefined;
    }

    try {
      const st = fs.statSync(diskPath);
      const now = Date.now();
      this.ensureParentDirs(key);

      if (st.isDirectory()) {
        const entry: ExampleFileEntry = {
          type: vscode.FileType.Directory,
          ctime: st.ctimeMs || now,
          mtime: st.mtimeMs || now,
          originFsPath: diskPath,
        };
        this.entries.set(key, entry);
        log(`[ExampleFS] hydrate dir ${key} <- ${diskPath}`);
        return entry;
      }

      if (st.isFile()) {
        const data = new Uint8Array(fs.readFileSync(diskPath));
        const entry: ExampleFileEntry = {
          type: vscode.FileType.File,
          data,
          ctime: st.ctimeMs || now,
          mtime: st.mtimeMs || now,
          originFsPath: diskPath,
        };
        this.entries.set(key, entry);
        log(
          `[ExampleFS] hydrate file ${key} <- ${diskPath} (${data.byteLength} bytes)`
        );
        return entry;
      }
    } catch (e) {
      warn(`[ExampleFS] hydrate failed ${key}: ${e}`);
    }
    return undefined;
  }

  private diskPathForKey(key: string): string | undefined {
    if (!this.sourcesRoot) {
      return undefined;
    }
    const rel = key.replace(/^\//, "");
    if (!rel) {
      return this.sourcesRoot;
    }
    // Prevent path escape
    const resolved = path.resolve(this.sourcesRoot, rel);
    if (
      resolved !== this.sourcesRoot &&
      !resolved.startsWith(this.sourcesRoot + path.sep)
    ) {
      warn(`[ExampleFS] blocked path escape: ${key}`);
      return undefined;
    }
    return resolved;
  }

  private ensureParentDirs(fileKey: string): void {
    const parts = fileKey.split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      this.ensureDir(cur);
    }
  }

  private ensureDir(dirKey: string): void {
    const key = dirKey === "" ? "/" : this.normalizeKey(dirKey);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.type !== vscode.FileType.Directory) {
        throw vscode.FileSystemError.FileNotADirectory(this.uriFromKey(key));
      }
      return;
    }
    const now = Date.now();
    if (key !== "/") {
      const parent = key.slice(0, key.lastIndexOf("/")) || "/";
      this.ensureDir(parent);
    }
    this.entries.set(key, {
      type: vscode.FileType.Directory,
      ctime: now,
      mtime: now,
    });
  }

  private uriFromKey(key: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: ExampleFileSystemProvider.scheme,
      authority: "examples",
      path: key.startsWith("/") ? key : "/" + key,
    });
  }

  private async promptSaveAs(
    uri: vscode.Uri,
    content: Uint8Array,
    originFsPath?: string
  ): Promise<void> {
    const rel = this.getRelativePath(uri);
    const defaultName = path.basename(rel) || "example.py";
    let defaultUri: vscode.Uri | undefined;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      defaultUri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    } else if (originFsPath) {
      const dir = path.dirname(originFsPath);
      const ext = path.extname(defaultName);
      const stem = path.basename(defaultName, ext);
      defaultUri = vscode.Uri.file(path.join(dir, `${stem}_copy${ext}`));
    }

    const filters: { [name: string]: string[] } = {
      [vscode.l10n.t("Python")]: ["py"],
      [vscode.l10n.t("All files")]: ["*"],
    };
    const ext = path.extname(defaultName).replace(/^\./, "");
    if (ext && ext !== "py") {
      filters[vscode.l10n.t("Source")] = [ext];
    }

    const target = await vscode.window.showSaveDialog({
      title: vscode.l10n.t("Save Example As"),
      saveLabel: vscode.l10n.t("Save As"),
      defaultUri,
      filters,
    });

    if (!target) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("Example kept in the virtual editor only. Use Save again to choose a file path.")
      );
      log("[ExampleFS] Save As cancelled");
      return;
    }

    try {
      await vscode.workspace.fs.writeFile(target, content);
      log(`[ExampleFS] saved as ${target.fsPath}`);
      const open = vscode.l10n.t("Open Saved File");
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t("Saved example as {0}", target.fsPath),
        open
      );
      if (choice === open) {
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    } catch (e) {
      warn(`[ExampleFS] Save As failed: ${e}`);
      vscode.window.showErrorMessage(vscode.l10n.t("Failed to save example: {0}", String(e)));
    }
  }

  private keyOf(uri: vscode.Uri): string {
    return this.normalizeKey(uri.path || "/");
  }

  private normalizeKey(p: string): string {
    let s = p.replace(/\\/g, "/");
    if (!s.startsWith("/")) {
      s = "/" + s;
    }
    s = s.replace(/\/+/g, "/");
    if (s.length > 1 && s.endsWith("/")) {
      s = s.slice(0, -1);
    }
    return s || "/";
  }

  private normalizeRelative(relativePath: string): string {
    let s = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    s = s.replace(/^extracted\//, "");
    const parts: string[] = [];
    for (const part of s.split("/")) {
      if (!part || part === ".") {
        continue;
      }
      if (part === "..") {
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return parts.join("/") || "untitled.py";
  }
}
