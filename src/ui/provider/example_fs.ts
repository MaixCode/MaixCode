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
 * path: /<relative/path>  (e.g. example:/basic/hello_maix.py)
 *
 * Save (writeFile) keeps the virtual buffer and prompts Save As to a real path.
 */
export class ExampleFileSystemProvider implements vscode.FileSystemProvider {
  static readonly scheme = "example";

  private readonly entries = new Map<string, ExampleFileEntry>();
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  private nextSaveAsShouldPrompt = true;

  constructor() {
    // Ensure virtual root exists
    const now = Date.now();
    this.entries.set("/", {
      type: vscode.FileType.Directory,
      ctime: now,
      mtime: now,
    });
  }

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const key = this.keyOf(uri);
    const entry = this.entries.get(key);
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
      // directories first, then name
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
    const key = this.keyOf(uri);
    const entry = this.entries.get(key);
    if (!entry || entry.type !== vscode.FileType.File || !entry.data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry.data;
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const key = this.keyOf(uri);
    const existing = this.entries.get(key);
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
      originFsPath: existing?.originFsPath,
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
    const entry = this.entries.get(key);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (entry.type === vscode.FileType.Directory) {
      const prefix = key === "/" ? "/" : key + "/";
      const childKeys = [...this.entries.keys()].filter(
        (k) => k !== key && k.startsWith(prefix)
      );
      if (childKeys.length && !options.recursive) {
        throw vscode.FileSystemError.NoPermissions(
          "Directory is not empty"
        );
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
    const entry = this.entries.get(oldKey);
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

  /**
   * Create or replace a virtual example document.
   * @param relativePath path under the examples root, e.g. "vision/hello.py" or "hello.py"
   */
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
      originFsPath: options?.originFsPath,
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
    return this.entries.get(this.keyOf(uri));
  }

  getText(uri: vscode.Uri): string | undefined {
    const entry = this.getEntry(uri);
    if (!entry?.data) {
      return undefined;
    }
    return new TextDecoder("utf-8").decode(entry.data);
  }

  /** Relative path without leading slash, for display / Save As defaults */
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

  private ensureParentDirs(fileKey: string): void {
    const parts = fileKey.split("/").filter(Boolean);
    // all but last segment
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
    // ensure parents
    if (key !== "/") {
      const parent = key.slice(0, key.lastIndexOf("/")) || "/";
      this.ensureDir(parent);
    }
    this.entries.set(key, {
      type: vscode.FileType.Directory,
      ctime: now,
      mtime: now,
    });
    this._emitter.fire([
      {
        type: vscode.FileChangeType.Created,
        uri: this.uriFromKey(key),
      },
    ]);
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
      // Preserve relative folder under workspace when possible
      defaultUri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    } else if (originFsPath) {
      const dir = path.dirname(originFsPath);
      const ext = path.extname(defaultName);
      const stem = path.basename(defaultName, ext);
      defaultUri = vscode.Uri.file(path.join(dir, `${stem}_copy${ext}`));
    }

    const filters: { [name: string]: string[] } = {
      Python: ["py"],
      "All files": ["*"],
    };
    const ext = path.extname(defaultName).replace(/^\./, "");
    if (ext && ext !== "py") {
      filters["Source"] = [ext];
    }

    const target = await vscode.window.showSaveDialog({
      title: "Save Example As",
      saveLabel: "Save As",
      defaultUri,
      filters,
    });

    if (!target) {
      vscode.window.showInformationMessage(
        "Example kept in the virtual editor only. Use Save again to choose a file path."
      );
      log("[ExampleFS] Save As cancelled");
      return;
    }

    try {
      await vscode.workspace.fs.writeFile(target, content);
      log(`[ExampleFS] saved as ${target.fsPath}`);
      const open = "Open Saved File";
      const choice = await vscode.window.showInformationMessage(
        `Saved example as ${target.fsPath}`,
        open
      );
      if (choice === open) {
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    } catch (e) {
      warn(`[ExampleFS] Save As failed: ${e}`);
      vscode.window.showErrorMessage(`Failed to save example: ${e}`);
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
    // collapse // and remove trailing slash (except root)
    s = s.replace(/\/+/g, "/");
    if (s.length > 1 && s.endsWith("/")) {
      s = s.slice(0, -1);
    }
    return s || "/";
  }

  private normalizeRelative(relativePath: string): string {
    let s = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    // strip leading "extracted/" if present
    s = s.replace(/^extracted\//, "");
    // normalize . and ..
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
