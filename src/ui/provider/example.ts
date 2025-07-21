import * as vscode from "vscode";
import axios from "axios";
import * as yaml from "yamljs";
import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";
import { Commands } from "../../constants";
import { info } from "../../logger";

class ExampleDocumentContentProvider implements vscode.TextDocumentContentProvider {
  private documents = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) || '';
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
  }
}

export class ExampleFileProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | void
  > = this._onDidChangeTreeData.event;

  private sipeedCdnBaseUrl = "https://cdn.sipeed.com/maixvision/examples";
  private cacheDir: string;
  private cacheFile: string;
  private documentProvider = new ExampleDocumentContentProvider();
  private treeView: vscode.TreeView<vscode.TreeItem>;

  constructor(private context: vscode.ExtensionContext) {
    // this.cacheDir = path.join(context.globalStoragePath, "cache");
    this.cacheDir = path.join(context.globalStorageUri.fsPath, "cache");
    this.cacheFile = path.join(this.cacheDir, "fileTree.json");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // 注册虚拟文档内容提供器
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('example', this.documentProvider)
    );

    // 创建 TreeView
    this.treeView = vscode.window.createTreeView('maixcode-example', {
      treeDataProvider: this,
      showCollapseAll: true,
      canSelectMany: false,
      dragAndDropController: undefined // 可以在未来添加拖拽支持
    });

    // 注册 TreeView 到 context 的 subscriptions
    context.subscriptions.push(this.treeView);

    // 注册 TreeView 事件处理器
    this.setupTreeViewEvents();
  }

  public async refresh(): Promise<void> {
    /* Clear cache */
    info("[ExampleFileProvider] Refreshing example files...");
    await this.downloadAndExtract();
    this._onDidChangeTreeData.fire();
  }

  private setupTreeViewEvents(): void {
    // 处理 TreeView 选择变化事件
    this.treeView.onDidChangeSelection(async (e) => {
      if (e.selection.length > 0) {
        const selectedItem = e.selection[0];
        if (selectedItem.contextValue === 'file' && selectedItem.resourceUri) {
          await this.openFile(selectedItem.resourceUri);
        }
      }
    });
    // 处理 TreeView 可见性变化事件
    // this.treeView.onDidChangeVisibility((e) => {
    //   if (e.visible) {
    //     info("[ExampleFileProvider] TreeView became visible");
    //     // 可以在这里触发数据刷新或其他操作
    //   }
    // });

    // 处理 TreeView 聚焦变化事件
    // this.treeView.onDidChangeCheckboxState && this.treeView.onDidChangeCheckboxState((e) => {
    //   // 如果需要复选框功能，可以在这里处理
    //   info("[ExampleFileProvider] Checkbox state changed");
    // });
  }

  // 添加方便的方法来控制 TreeView
  public async reveal(element: vscode.TreeItem): Promise<void> {
    try {
      await this.treeView.reveal(element, { 
        select: true, 
        focus: true,
        expand: true
      });
    } catch (error) {
      console.error('Error revealing tree item:', error);
    }
  }

  public get selection(): readonly vscode.TreeItem[] {
    return this.treeView.selection;
  }

  public get visible(): boolean {
    return this.treeView.visible;
  }

  // 设置 TreeView 的标题和描述
  public updateTreeViewDisplay(title?: string, description?: string): void {
    if (title) {
      this.treeView.title = title;
    }
    if (description) {
      this.treeView.description = description;
    }
  }

  // 展开或折叠所有节点
  public async expandAll(): Promise<void> {
    // 这需要遍历所有节点并展开它们
    // 实际实现会依赖于具体的文件结构
    this._onDidChangeTreeData.fire();
  }

  // 获取 TreeView 实例
  public getTreeView(): vscode.TreeView<vscode.TreeItem> {
    return this.treeView;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const fileTree = await this.getFileTree();
      return this.createTreeItems(fileTree, `${this.cacheDir}/extracted`);
    } else {
      const filePath = element.resourceUri?.fsPath;
      if (
        filePath &&
        fs.existsSync(filePath) &&
        fs.statSync(filePath).isDirectory()
      ) {
        const fileTree = this.buildFileTree(filePath);
        return this.createTreeItems(fileTree, filePath);
      }
      return [];
    }
  }

  private async downloadAndExtract(): Promise<void> {
    try {
      const response = await axios.get(
        `${(this, this.sipeedCdnBaseUrl)}/latest.yml`
      );
      const yamlContent = response.data;
      const parsedYaml = yaml.parse(yamlContent);
      const zipUrl = `${this.sipeedCdnBaseUrl}/${parsedYaml.version}.zip`;

      const zipResponse = await axios.get(zipUrl, {
        responseType: "arraybuffer",
      });
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(zipResponse.data);

      const extractPath = path.join(this.cacheDir, "extracted");
      if (!fs.existsSync(extractPath)) {
        fs.mkdirSync(extractPath, { recursive: true });
      }

      await this.extractZip(zipContent, extractPath);
      await this.saveFileTree(extractPath);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error downloading or extracting files: ${error}`
      );
    }
  }

  private async extractZip(
    zipContent: JSZip,
    extractPath: string
  ): Promise<void> {
    const files = Object.keys(zipContent.files);
    await Promise.all(
      files.map(async (fileName) => {
        const file = zipContent.files[fileName];
        const filePath = path.join(extractPath, fileName);
        if (file.dir) {
          if (!fs.existsSync(filePath)) {
            await fs.promises.mkdir(filePath, { recursive: true });
          }
        } else {
          const content = await file.async("nodebuffer");
          await fs.promises.writeFile(filePath, content);
        }
      })
    );
  }

  private async saveFileTree(extractPath: string): Promise<void> {
    const fileTree = this.buildFileTree(extractPath);
    fs.writeFileSync(this.cacheFile, JSON.stringify(fileTree, null, 2));
  }

  private buildFileTree(dir: string): any {
    const result: any = {};
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        result[file] = this.buildFileTree(filePath);
      } else {
        result[file] = null;
      }
    }
    return result;
  }

  private async getFileTree(): Promise<any> {
    if (fs.existsSync(this.cacheFile)) {
      const fileTreeContent = await fs.promises.readFile(
        this.cacheFile,
        "utf-8"
      );
      return JSON.parse(fileTreeContent);
    }
    return {};
  }

  static async guessLanguageType(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const languages = await vscode.languages.getLanguages();
      for (const language of languages) {
        const filter: vscode.DocumentFilter = { language };
        if (vscode.languages.match(filter, document)) {
          return language;
        }
      }
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
        "You are opening the source file. Your modifications MAY BE LOST!"
      );
      await vscode.window.showTextDocument(uri);
    } else {
      // 读取文件内容
      const fileContent = fs.readFileSync(uri.fsPath, "utf-8");

      // 猜测文件语言类型
      let language = await ExampleFileProvider.guessLanguageType(uri);
      if (!language) {
        language = "plaintext";
      }

      // 创建虚拟文档 URI
      const virtualUri = vscode.Uri.parse(`example:${path.basename(uri.fsPath)}?${encodeURIComponent(uri.fsPath)}`);
      
      // 设置虚拟文档内容
      this.documentProvider.setContent(virtualUri, fileContent);

      // 打开虚拟文档
      const document = await vscode.workspace.openTextDocument(virtualUri);
      
      // 设置语言模式
      // await vscode.languages.setTextDocumentLanguage(document, language);

      // 以预览模式打开文档
      const options: vscode.TextDocumentShowOptions = {
        preview: true,
        preserveFocus: true,
      };

      await vscode.window.showTextDocument(document, options);
    }
  }

  private createTreeItems(
    fileTree: any,
    parentPath: string = ""
  ): vscode.TreeItem[] {
    const folders: vscode.TreeItem[] = [];
    const files: vscode.TreeItem[] = [];

    for (const key in fileTree) {
      const filePath = path.join(parentPath, key);
      const treeItem = new vscode.TreeItem(
        key,
        fileTree[key]
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      );
      treeItem.contextValue = fileTree[key] ? "folder" : "file";
      treeItem.resourceUri = vscode.Uri.file(filePath);
      
      if (!fileTree[key]) {
        // 文件项 - 不设置命令，通过 TreeView 选择事件处理
        treeItem.tooltip = `Open file: ${key}`;
        files.push(treeItem);
      } else {
        // 文件夹项
        treeItem.tooltip = `Folder: ${key}`;
        folders.push(treeItem);
      }
    }

    return [...folders, ...files];
  }
}
