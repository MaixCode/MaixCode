import * as vscode from "vscode";
import { Commands } from "../constants";
import { PluginRegistry, PluginRecord } from "./registry";
import { PluginStorage } from "./storage";

type ManagerMessage =
  | { type: "ready" }
  | { type: "import" }
  | { type: "reload"; id: string }
  | { type: "enable"; id: string }
  | { type: "disable"; id: string }
  | { type: "remove"; id: string }
  | { type: "reveal"; id?: string }
  | { type: "runCommand"; id: string; commandId: string };

export class PluginManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: PluginRegistry,
    private readonly storage: PluginStorage
  ) {
    this.subscriptions.push(
      this.registry.onDidChangePlugins(() => {
        void this.postState();
      })
    );
  }

  public async open(): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "maixcodePluginManager",
        vscode.l10n.t("Plugin Manager"),
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
        }
      );
      this.panel.webview.html = this.getHtml(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((message: ManagerMessage) => {
        void this.handleMessage(message);
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    await this.postState();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private async handleMessage(message: ManagerMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.postState();
        return;
      case "import":
        await vscode.commands.executeCommand(Commands.importLocalPlugin);
        return;
      case "reload":
        await this.runAction(() => this.registry.reload(message.id));
        return;
      case "enable":
        await this.runAction(() => this.registry.setEnabled(message.id, true));
        return;
      case "disable":
        await this.runAction(() => this.registry.setEnabled(message.id, false));
        return;
      case "remove":
        await this.confirmRemove(message.id);
        return;
      case "reveal":
        if (message.id) {
          await this.storage.revealPlugin(message.id);
        } else {
          await this.storage.revealRoot();
        }
        return;
      case "runCommand":
        await this.runAction(async () => {
          await vscode.commands.executeCommand(message.commandId);
        });
        return;
      default:
        return;
    }
  }

  private async confirmRemove(id: string): Promise<void> {
    const plugin = this.registry.list().find((item) => item.id === id);
    if (!plugin) {
      return;
    }
    const removeText = vscode.l10n.t("Remove");
    const picked = await vscode.window.showWarningMessage(
      vscode.l10n.t("Remove plugin {0}?", plugin.manifest.name),
      { modal: true },
      removeText
    );
    if (picked !== removeText) {
      return;
    }
    await this.runAction(() => this.registry.remove(id));
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      await vscode.window.showErrorMessage(
        vscode.l10n.t("Plugin action failed: {0}", error instanceof Error ? error.message : String(error))
      );
    }
    await this.postState();
  }

  private async postState(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const plugins = this.registry.list().map((plugin) => this.serializePlugin(plugin));
    await this.panel.webview.postMessage({
      type: "state",
      plugins,
      labels: {
        empty: vscode.l10n.t("No plugins installed yet."),
        enable: vscode.l10n.t("Enable"),
        disable: vscode.l10n.t("Disable"),
        reload: vscode.l10n.t("Reload"),
        reveal: vscode.l10n.t("Reveal"),
        remove: vscode.l10n.t("Remove"),
        name: vscode.l10n.t("Name"),
        id: vscode.l10n.t("ID"),
        version: vscode.l10n.t("Version"),
        source: vscode.l10n.t("Source"),
        state: vscode.l10n.t("State"),
        entry: vscode.l10n.t("Entry"),
        path: vscode.l10n.t("Path"),
        permissions: vscode.l10n.t("Permissions"),
        error: vscode.l10n.t("Error"),
        commands: vscode.l10n.t("Commands"),
        run: vscode.l10n.t("Run"),
        none: "-",
      },
    });
  }

  private serializePlugin(plugin: PluginRecord): Record<string, unknown> {
    const commands = plugin.manifest.contributes?.commands?.map((cmd) => ({
      id: cmd.id,
      title: cmd.title,
    }));
    return {
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      source: plugin.source,
      enabled: plugin.enabled,
      active: plugin.active,
      state: plugin.state,
      builtin: plugin.builtin,
      permissions: plugin.manifest.permissions,
      main: plugin.manifest.main,
      directoryPath: plugin.directoryPath,
      lastError: plugin.lastError,
      commands,
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
    ].join("; ");
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "plugin_manager.js")
    );
    const title = escapeHtml(vscode.l10n.t("Plugin Manager"));
    const importText = escapeHtml(vscode.l10n.t("Import Plugin"));
    const openDirText = escapeHtml(vscode.l10n.t("Open Plugin Folder"));
    const detailText = escapeHtml(vscode.l10n.t("Plugin Details"));
    const emptyText = escapeHtml(vscode.l10n.t("Select a plugin to inspect and manage."));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .layout { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--vscode-panel-border); padding: 16px; display: grid; gap: 12px; align-content: start; }
    .detail { padding: 16px; display: grid; gap: 12px; align-content: start; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button { font: inherit; border: none; border-radius: 8px; padding: 8px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #pluginList { display: grid; gap: 8px; }
    .item { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--vscode-panel-border); cursor: pointer; }
    .item.active { outline: 2px solid var(--vscode-focusBorder); }
    .meta, .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .sidebar { border-right: none; border-bottom: 1px solid var(--vscode-panel-border); } }
  </style>
</head>
<body>
  <div class="layout">
    <section class="sidebar">
      <div class="actions">
        <button id="importBtn">${importText}</button>
        <button id="openFolderBtn">${openDirText}</button>
      </div>
      <div id="pluginList"></div>
    </section>
    <section class="detail">
      <h2>${detailText}</h2>
      <div id="emptyHint" class="hint">${emptyText}</div>
      <div id="detailCard" class="card" hidden>
        <div class="actions" id="detailActions"></div>
        <div id="detailBody"></div>
      </div>
    </section>
  </div>
  <script src="${script}"></script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
