import * as vscode from "vscode";
import axios from "axios";
import * as yaml from "yamljs";
import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";

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

  constructor(private context: vscode.ExtensionContext) {
    // this.cacheDir = path.join(context.globalStoragePath, "cache");
    this.cacheDir = path.join(context.globalStorageUri.fsPath, "cache");
    this.cacheFile = path.join(this.cacheDir, "fileTree.json");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    // this.refresh();
    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.refreshExamples", () =>
        this.refresh()
      ),
      vscode.commands.registerCommand("maixcode.openExample", (arg) => {
        if (arg instanceof vscode.Uri) {
          this.openFile(arg);
        } else {
          vscode.window.showErrorMessage("Invalid file URI");
          // TODO: Select file by user
        }
      }),
      vscode.commands.registerCommand("maixcode.openSourceExample", (arg) => {
        if (arg instanceof vscode.TreeItem) {
          this.openFile(arg.resourceUri!, true);
        } else {
          vscode.window.showErrorMessage("Invalid file URI");
        }
      })
    );
  }

  async refresh(): Promise<void> {
    /* Clear cache */
    await this.downloadAndExtract();
    this._onDidChangeTreeData.fire();
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

  private async openFile(
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
      
      // 创建只读文档
      const document = await vscode.workspace.openTextDocument({
        language: language,
        content: fileContent
      });
      
      // 以只读和预览模式打开文档
      const options: vscode.TextDocumentShowOptions = {
        preview: true,
        preserveFocus: true
      };
      
      const editor = await vscode.window.showTextDocument(document, options);
      // const relativePath = path.relative(this.cacheDir, uri.fsPath);
      // uri = uri.with({ path: "/~ " + path.basename(uri.path) });
      // vscode.workspace.openTextDocument(uri);
      // 以预览模式打开文件
      // const options: vscode.TextDocumentShowOptions = {
      //   preview: true, // 设置为 true 表示以预览模式打开
      //   // viewColumn: vscode.ViewColumn.Beside, // 在旁边打开

      // };
      // await vscode.window.showTextDocument(uri, options);
      // const file_content = fs.readFileSync(uri.fsPath, "utf-8");
      // var language = await ExampleFileProvider.guessLanguageType(uri);
      // if (!language) {
      //   language = "plaintext";
      // }
      // const document = await vscode.workspace.openTextDocument({
      //   language: language,
      //   content: file_content,
      // });
      // await vscode.window.showTextDocument(document);
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
        treeItem.command = {
          command: "maixcode.openExample",
          title: "Open File",
          arguments: [treeItem.resourceUri],
        };
        files.push(treeItem);
      } else {
        folders.push(treeItem);
      }
    }

    return [...folders, ...files];
  }
}
