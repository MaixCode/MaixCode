import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const DisabledPluginsStateKey = "maixcode.disabledPlugins";

export class PluginStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public getRootPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, "plugins");
  }

  public async ensureRoot(): Promise<void> {
    await fs.mkdir(this.getRootPath(), { recursive: true });
  }

  public async listPluginDirectories(): Promise<string[]> {
    await this.ensureRoot();
    const entries = await fs.readdir(this.getRootPath(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.getRootPath(), entry.name))
      .sort((left, right) => left.localeCompare(right));
  }

  public getPluginPath(id: string): string {
    return path.join(this.getRootPath(), id);
  }

  public async installFromFolder(sourcePath: string, id: string): Promise<string> {
    await this.ensureRoot();
    const targetPath = this.getPluginPath(id);
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
    return targetPath;
  }

  public async removePlugin(id: string): Promise<void> {
    await fs.rm(this.getPluginPath(id), { recursive: true, force: true });
  }

  public async revealRoot(): Promise<void> {
    await this.ensureRoot();
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.getRootPath()));
  }

  public async revealPlugin(id: string): Promise<void> {
    await this.ensureRoot();
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.getPluginPath(id)));
  }

  public getDisabledPluginIds(): Set<string> {
    return new Set(this.context.globalState.get<string[]>(DisabledPluginsStateKey, []));
  }

  public async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    const ids = this.getDisabledPluginIds();
    if (enabled) {
      ids.delete(id);
    } else {
      ids.add(id);
    }
    await this.context.globalState.update(DisabledPluginsStateKey, Array.from(ids).sort());
  }

  public async forgetPlugin(id: string): Promise<void> {
    const ids = this.getDisabledPluginIds();
    ids.delete(id);
    await this.context.globalState.update(DisabledPluginsStateKey, Array.from(ids).sort());
  }
}
