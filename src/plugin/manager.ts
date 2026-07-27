import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Commands } from "../constants";
import { PluginRegistry, PluginRecord } from "./registry";
import { PluginStorage } from "./storage";
import { MarketplaceService } from "./marketplace";
import { log } from "../logger";

type ManagerMessage =
  | { type: "ready" }
  | { type: "switchTab"; tab: "installed" | "marketplace" }
  | { type: "import" }
  | { type: "reload"; id: string }
  | { type: "enable"; id: string }
  | { type: "disable"; id: string }
  | { type: "remove"; id: string }
  | { type: "reveal"; id?: string }
  | { type: "runCommand"; id: string; commandId: string }
  | { type: "installMarketplace"; id: string }
  | { type: "refreshMarketplace" };

export class PluginManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private currentTab: "installed" | "marketplace" = "installed";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: PluginRegistry,
    private readonly storage: PluginStorage,
    private readonly marketplace: MarketplaceService
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

  public async refreshMarketplace(): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Refreshing plugin marketplace...") },
      async (progress) => {
        await this.marketplace.refreshIndexes((msg) => progress.report({ message: msg }));
      }
    );
    if (this.panel) {
      await this.postState();
    }
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
      case "switchTab":
        this.currentTab = message.tab;
        if (message.tab === "marketplace" && !this.marketplace.getConfigs().length) {
          vscode.window.showWarningMessage(
            vscode.l10n.t("No plugin marketplaces configured. Add marketplace sources in MaixCode settings.")
          );
        }
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
      case "installMarketplace":
        await this.runAction(async () => {
          await this.installMarketplacePlugin(message.id);
        });
        return;
      case "refreshMarketplace":
        await this.refreshMarketplace();
        return;
      default:
        return;
    }
  }

  private async installMarketplacePlugin(entryId: string): Promise<void> {
    const entries = this.marketplace.getAllEntries();
    const match = entries.find((item) => item.entry.id === entryId);
    if (!match) {
      throw new Error(`Marketplace plugin not found: ${entryId}`);
    }
    const tmpDir = path.join(this.storage.getRootPath(), `.marketplace-tmp-${match.entry.id}`);
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      await this.marketplace.downloadTo(match.entry, tmpDir);
      const installed = await this.registry.importFromFolder(tmpDir);
      log(`[PluginManager] installed marketplace plugin ${installed.manifest.name} v${installed.manifest.version}`);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
      await this.postState();
    } catch (error) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Plugin action failed: {0}", error instanceof Error ? error.message : String(error))
      );
      await this.postState();
    }
  }

  private async postState(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const plugins = this.registry.list().map((p) => this.serializePlugin(p));
    const marketplace = this.marketplace.getConfigs().length
      ? this.serializeMarketplace()
      : [];
    const installed = this.marketplace.getInstalledMap();
    const updates = await this.marketplace.checkForUpdates();
    const updateIds = new Set(updates.map((u) => u.entry.id));
    await this.panel.webview.postMessage({
      type: "state",
      tab: this.currentTab,
      plugins,
      marketplace,
      marketplaceConfigured: this.marketplace.getConfigs().length > 0,
      updateIds: Array.from(updateIds),
      labels: {
        installedTab: vscode.l10n.t("Installed"),
        marketplaceTab: vscode.l10n.t("Marketplace"),
        plugins: vscode.l10n.t("Plugins"),
        details: vscode.l10n.t("Plugin Details"),
        selectHint: vscode.l10n.t("Select a plugin to inspect and manage."),
        empty: vscode.l10n.t("No plugins installed yet."),
        marketplaceEmpty: vscode.l10n.t("No marketplace configured. Add sources in MaixCode settings."),
        marketplaceLoading: vscode.l10n.t("Click Refresh to load available plugins."),
        enable: vscode.l10n.t("Enable"),
        disable: vscode.l10n.t("Disable"),
        reload: vscode.l10n.t("Reload"),
        reveal: vscode.l10n.t("Reveal"),
        remove: vscode.l10n.t("Remove"),
        name: vscode.l10n.t("Name"),
        id: vscode.l10n.t("ID"),
        version: vscode.l10n.t("Version"),
        source: vscode.l10n.t("Source"),
        installedVersion: vscode.l10n.t("Installed Version"),
        state: vscode.l10n.t("State"),
        entry: vscode.l10n.t("Entry"),
        path: vscode.l10n.t("Path"),
        permissions: vscode.l10n.t("Permissions"),
        error: vscode.l10n.t("Error"),
        commands: vscode.l10n.t("Commands"),
        run: vscode.l10n.t("Run"),
        none: "-",
        install: vscode.l10n.t("Install"),
        installed: vscode.l10n.t("Installed"),
        update: vscode.l10n.t("Update"),
        description: vscode.l10n.t("Description"),
        author: vscode.l10n.t("Author"),
        refresh: vscode.l10n.t("Refresh"),
        importPlugin: vscode.l10n.t("Import Plugin"),
        openFolder: vscode.l10n.t("Open Plugin Folder"),
        localSource: vscode.l10n.t("Local"),
        marketplaceSection: vscode.l10n.t("Marketplace"),
        localSection: vscode.l10n.t("Local Plugins"),
        reinstall: vscode.l10n.t("Reinstall"),
        searchHint: vscode.l10n.t("Search plugins..."),
        searchNoResults: vscode.l10n.t("No plugins match your search."),
        builtin: vscode.l10n.t("Built-in"),
        local: vscode.l10n.t("Local"),
        active: vscode.l10n.t("Active"),
        inactive: vscode.l10n.t("Inactive"),
        disabled: vscode.l10n.t("Disabled"),
        errorState: vscode.l10n.t("Error"),
        count: vscode.l10n.t("{0} plugins"),
      },
    });
  }

  private serializeMarketplace(): Record<string, unknown>[] {
    const installed = this.marketplace.getInstalledMap();
    const marketplaceIds = this.marketplace.getMarketplacePluginIds();
    const configs = this.marketplace.getConfigs();
    const configLabel = new Map(configs.map((c) => [c.id, c.label]));
    const result: Record<string, unknown>[] = [];

    // Marketplace entries first
    for (const { entry, marketplaceId } of this.marketplace.getAllEntries()) {
      const sourceLabel = configLabel.get(marketplaceId) || marketplaceId;
      result.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description || "",
        author: entry.author?.name || "",
        sourceLabel: `${sourceLabel} ${vscode.l10n.t("Marketplace")}`,
        isLocal: false,
        marketplaceId,
        installed: installed.has(entry.id),
        installedVersion: installed.get(entry.id)?.version || "",
        permissions: entry.permissions,
      });
    }

    // Local non-builtin plugins not already in a marketplace index
    for (const record of this.registry.list()) {
      if (record.builtin) continue;
      if (marketplaceIds.has(record.id)) continue;
      result.push({
        id: record.id,
        name: record.manifest.name,
        version: record.manifest.version,
        description: "",
        author: "",
        sourceLabel: vscode.l10n.t("Local"),
        isLocal: true,
        marketplaceId: "",
        installed: true,
        installedVersion: record.manifest.version,
        permissions: record.manifest.permissions,
      });
    }

    result.sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? 1 : -1;
      return (a.name as string).localeCompare(b.name as string);
    });
    return result;
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
    const installedTab = escapeHtml(vscode.l10n.t("Installed"));
    const marketplaceTab = escapeHtml(vscode.l10n.t("Marketplace"));
    const searchHint = escapeHtml(vscode.l10n.t("Search plugins..."));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      --pm-radius: 10px;
      --pm-border: var(--vscode-panel-border, rgba(127,127,127,0.35));
      --pm-bg: var(--vscode-editor-background);
      --pm-fg: var(--vscode-foreground);
      --pm-muted: var(--vscode-descriptionForeground);
      --pm-hover: var(--vscode-list-hoverBackground);
      --pm-active: var(--vscode-list-activeSelectionBackground);
      --pm-active-fg: var(--vscode-list-activeSelectionForeground);
      --pm-focus: var(--vscode-focusBorder);
      --pm-btn: var(--vscode-button-background);
      --pm-btn-fg: var(--vscode-button-foreground);
      --pm-btn2: var(--vscode-button-secondaryBackground);
      --pm-btn2-fg: var(--vscode-button-secondaryForeground);
      --pm-input-bg: var(--vscode-input-background);
      --pm-input-fg: var(--vscode-input-foreground);
      --pm-input-border: var(--vscode-input-border, transparent);
      --pm-card: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, rgba(127,127,127,0.08)));
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--pm-fg);
      background: var(--pm-bg);
      height: 100vh;
      overflow: hidden;
    }
    .layout { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
    .header {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 14px; border-bottom: 1px solid var(--pm-border); background: var(--pm-card);
    }
    .tabs {
      display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px;
      background: rgba(127,127,127,0.12);
    }
    .tab {
      border: none; background: transparent; color: var(--pm-muted); font: inherit;
      padding: 6px 14px; border-radius: 999px; cursor: pointer; white-space: nowrap;
    }
    .tab:hover { color: var(--pm-fg); }
    .tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 600;
    }
    .header-spacer { flex: 1; }
    .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .search-wrap { min-width: 180px; max-width: 280px; flex: 1; }
    input.search {
      width: 100%; font: inherit; border: 1px solid var(--pm-input-border);
      border-radius: 8px; padding: 7px 10px; background: var(--pm-input-bg);
      color: var(--pm-input-fg); outline: none;
    }
    input.search:focus { border-color: var(--pm-focus); }
    button {
      font: inherit; border: none; border-radius: 8px; padding: 7px 12px;
      background: var(--pm-btn); color: var(--pm-btn-fg); cursor: pointer;
    }
    button.secondary { background: var(--pm-btn2); color: var(--pm-btn2-fg); }
    button:disabled { opacity: 0.55; cursor: default; }
    button.danger { background: var(--vscode-inputValidation-errorBorder, #c72e0f); color: #fff; }
    .content {
      display: grid; grid-template-columns: minmax(300px, 380px) 1fr;
      min-height: 0; overflow: hidden;
    }
    .sidebar, .detail { min-height: 0; overflow: auto; padding: 14px; }
    .sidebar {
      border-right: 1px solid var(--pm-border);
      display: flex; flex-direction: column; gap: 10px;
    }
    .list-meta {
      display: flex; justify-content: space-between; align-items: center;
      color: var(--pm-muted); font-size: 12px; padding: 0 2px;
    }
    #pluginList, #marketplaceList { display: flex; flex-direction: column; gap: 8px; }
    #pluginList.hidden, #marketplaceList.hidden, .header-actions .hidden, button.hidden, input.search.hidden, .search-wrap.hidden {
      display: none !important;
    }
    .section-label {
      font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--pm-muted); padding: 10px 2px 2px;
    }
    .item {
      display: grid; gap: 6px; padding: 12px; border: 1px solid var(--pm-border);
      border-radius: var(--pm-radius); background: transparent; cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .item:hover { background: var(--pm-hover); }
    .item.active {
      background: var(--pm-active); color: var(--pm-active-fg); border-color: var(--pm-focus);
    }
    .item-title {
      display: flex; align-items: center; gap: 8px; font-weight: 600; line-height: 1.3;
    }
    .item-title > span:first-child { flex: 1; min-width: 0; word-break: break-word; }
    .item-meta {
      color: inherit; opacity: 0.78; font-size: 12px; line-height: 1.35; word-break: break-word;
    }
    .badges { display: flex; flex-wrap: wrap; gap: 4px; }
    .badge {
      display: inline-flex; align-items: center; font-size: 10px; font-weight: 600;
      line-height: 1; padding: 3px 7px; border-radius: 999px;
      background: rgba(127,127,127,0.18); color: inherit; white-space: nowrap;
    }
    .badge.update { background: var(--vscode-statusBarItem-warningBackground, #bf8803); color: var(--vscode-statusBarItem-warningForeground, #fff); }
    .badge.installed, .badge.active { background: var(--vscode-testing-iconPassed, #388a34); color: #fff; }
    .badge.error { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-errorForeground, #f48771); }
    .badge.disabled { background: rgba(127,127,127,0.25); }
    .badge.builtin { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .hint {
      color: var(--pm-muted); font-size: 13px; line-height: 1.5; padding: 18px 8px; text-align: center;
    }
    .detail { display: flex; flex-direction: column; gap: 12px; }
    .detail-header h2 { margin: 0; font-size: 18px; font-weight: 650; }
    .detail-sub { margin-top: 4px; color: var(--pm-muted); font-size: 12px; word-break: break-word; }
    .detail-card {
      border: 1px solid var(--pm-border); border-radius: 12px; background: var(--pm-card);
      padding: 14px; display: grid; gap: 14px;
    }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .fields {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;
    }
    .field {
      border: 1px solid var(--pm-border); border-radius: 10px; padding: 10px 12px;
      background: rgba(127,127,127,0.05); min-width: 0;
    }
    .field.wide { grid-column: 1 / -1; }
    .field-label {
      color: var(--pm-muted); font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.03em; margin-bottom: 6px;
    }
    .field-value {
      margin: 0; white-space: pre-wrap; word-break: break-word;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 12.5px; line-height: 1.45;
    }
    .commands { display: flex; flex-wrap: wrap; gap: 8px; }
    @media (max-width: 900px) {
      .content { grid-template-columns: 1fr; }
      .sidebar { border-right: none; border-bottom: 1px solid var(--pm-border); max-height: 42vh; }
      .header { flex-wrap: wrap; }
      .search-wrap { max-width: none; flex-basis: 100%; order: 3; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <header class="header">
      <div class="tabs">
        <button class="tab active" data-tab="installed">${installedTab}</button>
        <button class="tab" data-tab="marketplace">${marketplaceTab}</button>
      </div>
      <div class="header-spacer"></div>
      <div class="search-wrap" id="searchWrap">
        <input class="search" id="searchInput" type="search" placeholder="${searchHint}" />
      </div>
      <div class="header-actions" id="headerActions">
        <button id="importBtn" class="secondary"></button>
        <button id="openFolderBtn" class="secondary"></button>
        <button id="refreshMarketplaceBtn" class="secondary hidden"></button>
      </div>
    </header>
    <div class="content">
      <section class="sidebar">
        <div class="list-meta"><span id="listCount"></span></div>
        <div id="pluginList"></div>
        <div id="marketplaceList" class="hidden"></div>
      </section>
      <section class="detail">
        <div class="detail-header">
          <h2 id="detailTitle"></h2>
          <div id="detailSub" class="detail-sub"></div>
        </div>
        <div id="emptyHint" class="hint"></div>
        <div id="detailCard" class="detail-card" hidden>
          <div class="actions" id="detailActions"></div>
          <div class="fields" id="detailBody"></div>
        </div>
      </section>
    </div>
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
