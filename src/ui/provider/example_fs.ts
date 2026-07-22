import * as path from "path";
import * as vscode from "vscode";
import { log, warn } from "../../logger";

export type ExampleFileEntry = {
  data: Uint8Array;
  ctime: number;
  mtime: number;
  /** Original cached example path on disk (read-only source), if any */
  originFsPath?: string;
  languageId?: string;
};

/**
 * Writable virtual filesystem for MaixCode examples.
 * scheme: example
 * path: /<filename>  (e.g. example:/hello_maix.py)
 *
 * Save (writeFile) keeps the virtual buffer and prompts Save As to a real path.
 */
export class ExampleFileSystemProvider implements vscode.FileSystemProvider {
  static readonly scheme = "example";

  private readonly files = new Map<string, ExampleFileEntry>();
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  private nextSaveAsShouldPrompt = true;

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const key = this.keyOf(uri);
    const entry = this.files.get(key);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: entry.ctime,
      mtime: entry.mtime,
      size: entry.data.byteLength,
    };
  }

  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(_uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(
      "Example virtual FS does not support directories"
    );
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const key = this.keyOf(uri);
    const entry = this.files.get(key);
    if (!entry) {
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
    const existing = this.files.get(key);
    if (!existing && !options.create) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (existing && !options.overwrite) {
      throw vscode.FileSystemError.FileExists(uri);
    }

    const now = Date.now();
    const entry: ExampleFileEntry = {
      data: content,
      ctime: existing?.ctime ?? now,
      mtime: now,
      originFsPath: existing?.originFsPath,
      languageId: existing?.languageId,
    };
    this.files.set(key, entry);
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

    // Ctrl+S / Save: offer Save As (do not overwrite the cached example on disk)
    if (this.nextSaveAsShouldPrompt) {
      await this.promptSaveAs(uri, content, entry.originFsPath);
    }
  }

  delete(uri: vscode.Uri, _options: { recursive: boolean }): void {
    const key = this.keyOf(uri);
    if (!this.files.has(key)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    this.files.delete(key);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { overwrite: boolean }
  ): void {
    throw vscode.FileSystemError.NoPermissions(
      "Rename is not supported for example virtual files"
    );
  }

  /**
   * Create or replace a virtual example document and return its URI.
   */
  seedFile(
    fileName: string,
    content: string | Uint8Array,
    options?: { originFsPath?: string; languageId?: string }
  ): vscode.Uri {
    const base = path.basename(fileName);
    const uri = vscode.Uri.from({
      scheme: ExampleFileSystemProvider.scheme,
      path: "/" + base,
    });
    const data =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
    const now = Date.now();
    const key = this.keyOf(uri);
    const existing = this.files.get(key);
    this.files.set(key, {
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
    log(`[ExampleFS] seedFile ${uri.toString()} origin=${options?.originFsPath ?? "-"}`);
    return uri;
  }

  getEntry(uri: vscode.Uri): ExampleFileEntry | undefined {
    return this.files.get(this.keyOf(uri));
  }

  getText(uri: vscode.Uri): string | undefined {
    const entry = this.getEntry(uri);
    if (!entry) {
      return undefined;
    }
    return new TextDecoder("utf-8").decode(entry.data);
  }

  /** Temporarily skip Save As (e.g. internal writes). */
  async withSilentWrite<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.nextSaveAsShouldPrompt;
    this.nextSaveAsShouldPrompt = false;
    try {
      return await fn();
    } finally {
      this.nextSaveAsShouldPrompt = prev;
    }
  }

  private async promptSaveAs(
    uri: vscode.Uri,
    content: Uint8Array,
    originFsPath?: string
  ): Promise<void> {
    const defaultName = path.basename(uri.path) || "example.py";
    let defaultUri: vscode.Uri | undefined;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      defaultUri = vscode.Uri.joinPath(folder.uri, defaultName);
    } else if (originFsPath) {
      // Suggest next to origin but with a copy suffix so cache is not overwritten by accident
      const dir = path.dirname(originFsPath);
      const ext = path.extname(defaultName);
      const stem = path.basename(defaultName, ext);
      defaultUri = vscode.Uri.file(path.join(dir, `${stem}_copy${ext}`));
    }

    const filters: { [name: string]: string[] } = {
      "Python": ["py"],
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
    // Normalize path to /basename
    const base = path.posix.basename(uri.path.replace(/\\/g, "/")) || uri.path;
    return "/" + base.replace(/^\//, "");
  }
}
