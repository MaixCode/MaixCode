import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { info, log, warn } from "../../logger";
import { ExampleFileSystemProvider } from "./example_fs";
import { ExampleSource } from "../../service/example_source/types";
import { createExampleSources } from "../../service/example_source/registry";
import { buildFileTree, ensureDir } from "../../service/example_source/fs_util";

/** Tree node: source root or nested folder/file under a source */
class ExampleTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly sourceId: string | undefined,
    public readonly fsPath: string | undefined,
    contextValue: string
  ) {
    super(label, collapsible);
    this.contextValue = contextValue;
    if (fsPath) {
      this.resourceUri = vscode.Uri.file(fsPath);
    }
  }
}

export class ExampleFileProvider
  implements vscode.TreeDataProvider<ExampleTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    ExampleTreeItem | undefined | void
  > = new vscode.EventEmitter<ExampleTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ExampleTreeItem | undefined | void
  > = this._onDidChangeTreeData.event;

  private cacheDir: string;
  private sourcesRoot: string;
  private sources: ExampleSource[] = [];
  private readonly virtualFs = new ExampleFileSystemProvider();
  private treeView: vscode.TreeView<ExampleTreeItem>;
  private refreshing = false;

  constructor(private context: vscode.ExtensionContext) {
    this.cacheDir = path.join(context.globalStorageUri.fsPath, "cache");
    this.sourcesRoot = path.join(this.cacheDir, "sources");
    ensureDir(this.cacheDir);
    ensureDir(this.sourcesRoot);

    this.reloadSources();

    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(
        ExampleFileSystemProvider.scheme,
        this.virtualFs,
        {
          isCaseSensitive: true,
          isReadonly: false,
        }
      )
    );

    this.treeView = vscode.window.createTreeView("maixcode-example", {
      treeDataProvider: this,
      showCollapseAll: true,
      canSelectMany: false,
    });
    context.subscriptions.push(this.treeView);
    this.setupTreeViewEvents();

    // Reload source list when settings change
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("maixcode.exampleSources") ||
          e.affectsConfiguration("maixcode.githubToken")
        ) {
          log("[ExampleFileProvider] example source settings changed");
          this.reloadSources();
          this._onDidChangeTreeData.fire();
        }
      })
    );
  }

  private reloadSources(): void {
    this.sources = createExampleSources(this.cacheDir);
  }

  public async refresh(): Promise<void> {
    if (this.refreshing) {
      info("[ExampleFileProvider] refresh already in progress");
      return;
    }
    this.refreshing = true;
    this.reloadSources();
    info(
      `[ExampleFileProvider] Refreshing ${this.sources.length} example source(s)...`
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "MaixCode Examples",
        cancellable: false,
      },
      async (progress) => {
        for (const source of this.sources) {
          try {
            progress.report({ message: `Refreshing ${source.label}...` });
            await source.refresh((msg) => progress.report({ message: msg }));
            info(`[ExampleFileProvider] ${source.id} OK`);
          } catch (e) {
            warn(`[ExampleFileProvider] ${source.id} failed: ${e}`);
            vscode.window.showErrorMessage(
              `Example source "${source.label}" (${source.id}) failed: ${e}`
            );
          }
        }
      }
    );

    this.refreshing = false;
    this._onDidChangeTreeData.fire();
  }

  /** Refresh a single first-level source by id */
  public async refreshSource(sourceId: string): Promise<void> {
    this.reloadSources();
    const source = this.sources.find((s) => s.id === sourceId);
    if (!source) {
      vscode.window.showErrorMessage(`Example source not found: ${sourceId}`);
      return;
    }
    info(`[ExampleFileProvider] Refreshing source ${sourceId}...`);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `MaixCode: ${source.label}`,
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: `Refreshing ${source.label}...` });
          await source.refresh((msg) => progress.report({ message: msg }));
          info(`[ExampleFileProvider] ${source.id} OK`);
          vscode.window.showInformationMessage(
            `Example source "${source.label}" refreshed.`
          );
        } catch (e) {
          warn(`[ExampleFileProvider] ${source.id} failed: ${e}`);
          vscode.window.showErrorMessage(
            `Example source "${source.label}" failed: ${e}`
          );
        }
      }
    );
    this._onDidChangeTreeData.fire();
  }

  private setupTreeViewEvents(): void {
    this.treeView.onDidChangeSelection(async (e) => {
      if (e.selection.length > 0) {
        const selectedItem = e.selection[0];
        if (
          selectedItem.contextValue === "file" &&
          selectedItem.resourceUri
        ) {
          await this.openFile(selectedItem.resourceUri);
        }
      }
    });
  }

  public async reveal(element: ExampleTreeItem): Promise<void> {
    try {
      await this.treeView.reveal(element, {
        select: true,
        focus: true,
        expand: true,
      });
    } catch (error) {
      console.error("Error revealing tree item:", error);
    }
  }

  public get selection(): readonly ExampleTreeItem[] {
    return this.treeView.selection;
  }

  public get visible(): boolean {
    return this.treeView.visible;
  }

  public updateTreeViewDisplay(title?: string, description?: string): void {
    if (title) {
      this.treeView.title = title;
    }
    if (description) {
      this.treeView.description = description;
    }
  }

  public getTreeView(): vscode.TreeView<ExampleTreeItem> {
    return this.treeView;
  }

  getTreeItem(element: ExampleTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ExampleTreeItem): Promise<ExampleTreeItem[]> {
    // Root: one folder per source (first-level directory = source id / label)
    if (!element) {
      return this.sources.map((s) => {
        const item = new ExampleTreeItem(
          s.label,
          vscode.TreeItemCollapsibleState.Collapsed,
          s.id,
          s.rootDir,
          "exampleSource"
        );
        item.description = s.id;
        item.tooltip = `${s.label} (${s.type}: ${s.id})\n${s.rootDir}`;
        item.iconPath = new vscode.ThemeIcon(
          s.type === "github_repo"
            ? "github"
            : s.type === "local_folder"
              ? "folder-library"
              : "cloud-download"
        );
        return item;
      });
    }

    // Nested: list directory under source
    const filePath = element.fsPath;
    if (
      filePath &&
      fs.existsSync(filePath) &&
      fs.statSync(filePath).isDirectory()
    ) {
      return this.createTreeItems(
        buildFileTree(filePath),
        filePath,
        element.sourceId
      );
    }
    return [];
  }

  static async guessLanguageFromPath(
    filePath: string
  ): Promise<string | undefined> {
    const ext = path.extname(filePath).toLowerCase();
    const byExt: Record<string, string> = {
      ".py": "python",
      ".md": "markdown",
      ".json": "json",
      ".yml": "yaml",
      ".yaml": "yaml",
      ".txt": "plaintext",
      ".c": "c",
      ".cpp": "cpp",
      ".h": "c",
      ".js": "javascript",
      ".ts": "typescript",
    };
    if (byExt[ext]) {
      return byExt[ext];
    }
    try {
      const fileUri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(fileUri);
      return document.languageId;
    } catch (error) {
      console.error("Error guessing language type:", error);
    }
    return undefined;
  }

  public async openFile(
    uri: vscode.Uri,
    source: boolean = false
  ): Promise<void> {
    if (source) {
      await vscode.window.showWarningMessage(
        "You are opening the cached source file. Refreshing examples may overwrite your changes."
      );
      await vscode.window.showTextDocument(uri, { preview: false });
      return;
    }

    try {
      const fileContent = await fs.promises.readFile(uri.fsPath, "utf-8");
      let language =
        (await ExampleFileProvider.guessLanguageFromPath(uri.fsPath)) ||
        "plaintext";

      // Relative path under sources/ so virtual URI includes source id as first segment
      let rel = path.relative(this.sourcesRoot, uri.fsPath);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        rel = path.join(
          path.basename(path.dirname(uri.fsPath)),
          path.basename(uri.fsPath)
        );
      }
      rel = rel.split(path.sep).join("/");

      const virtualUri = this.virtualFs.seedFile(rel, fileContent, {
        originFsPath: uri.fsPath,
        languageId: language,
      });

      let document = await vscode.workspace.openTextDocument(virtualUri);
      if (language && document.languageId !== language) {
        document = await vscode.languages.setTextDocumentLanguage(
          document,
          language
        );
      }

      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });
      log(
        `[ExampleFileProvider] opened virtual editor ${virtualUri.toString()} lang=${language}`
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to open example: ${e}`);
    }
  }

  public getVirtualFs(): ExampleFileSystemProvider {
    return this.virtualFs;
  }

  public getSources(): ExampleSource[] {
    return this.sources.slice();
  }

  private createTreeItems(
    fileTree: Record<string, any>,
    parentPath: string,
    sourceId: string | undefined
  ): ExampleTreeItem[] {
    const folders: ExampleTreeItem[] = [];
    const files: ExampleTreeItem[] = [];

    for (const key of Object.keys(fileTree).sort()) {
      const filePath = path.join(parentPath, key);
      const isFolder = fileTree[key] !== null && typeof fileTree[key] === "object";
      const treeItem = new ExampleTreeItem(
        key,
        isFolder
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        sourceId,
        filePath,
        isFolder ? "folder" : "file"
      );

      if (!isFolder) {
        treeItem.tooltip = `Open: ${key}`;
        files.push(treeItem);
      } else {
        treeItem.tooltip = `Folder: ${key}`;
        folders.push(treeItem);
      }
    }

    return [...folders, ...files];
  }
}
