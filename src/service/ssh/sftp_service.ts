import * as vscode from "vscode";
import {
  ConfigKeys,
  ConfigSection,
  SftpMountsStateKey,
} from "../../constants";
import { error, formatUnknown, log } from "../../logger";
import { readSshCredentials } from "./credentials";
import {
  compileSftpHidePatterns,
  normalizeRemotePath,
  patternForPath,
} from "./sftp_path_filter";
import { readSftpBookmarks } from "./sftp_bookmarks";
import { SftpSession } from "./sftp_session";
import { SftpFileDecorationProvider } from "../../ui/provider/sftp_decoration";
import {
  buildSftpUri,
  SftpFileSystemProvider,
  type SftpMount,
} from "../../ui/provider/sftp_fs";

export type OpenSftpRequest = {
  host: string;
  deviceName?: string;
  port?: number;
  /** Suppress notifications / Explorer focus (auto-open). */
  quiet?: boolean;
};

/** Saved across window reloads (no live session). */
type PersistedSftpMount = {
  authority: string;
  host: string;
  port: number;
  remoteRoot: string;
  deviceName?: string;
};

/**
 * Manages SFTP mounts + FileSystemProvider registration.
 * One long-lived connection per device authority (separate from shell).
 */
export class SftpService {
  private readonly fs: SftpFileSystemProvider;
  private readonly decorations: SftpFileDecorationProvider;
  private disposed = false;
  private providerRegistered = false;
  /** Hosts currently opening via auto-open (dedupe). */
  private autoOpenInFlight = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.fs = new SftpFileSystemProvider();
    this.decorations = new SftpFileDecorationProvider(this.fs);
    this.fs.ensureMount = (authority) => this.remountAuthority(authority);
    this.ensureProviderRegistered();
    context.subscriptions.push(
      vscode.window.registerFileDecorationProvider(this.decorations),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.sftpHidePatterns}`
          ) ||
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.sftpReadOnly}`
          ) ||
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.sftpShowFiltered}`
          ) ||
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.sftpBookmarks}`
          )
        ) {
          this.fs.reloadFiltersFromConfig();
          this.fs.notifyExplorerRefresh(true);
          this.decorations.refresh();
          void vscode.commands.executeCommand(
            "workbench.files.action.refreshFilesExplorer"
          );
        }
      }),
      { dispose: () => this.decorations.dispose() }
    );
    // After reload, workspace may still list maixsftp folders — restore mounts.
    void this.restorePersistedMounts();
  }

  get fileSystem(): SftpFileSystemProvider {
    return this.fs;
  }

  async open(req: OpenSftpRequest): Promise<void> {
    if (this.disposed) {
      throw new Error("SftpService disposed");
    }
    const host = (req.host || "").trim();
    if (!host) {
      vscode.window.showErrorMessage(vscode.l10n.t("No device IP for SFTP"));
      return;
    }

    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const port = req.port ?? cfg.get<number>(ConfigKeys.sshPort, 22);
    const timeoutMs = cfg.get<number>(ConfigKeys.sshConnectTimeoutMs, 10000);
    const credentials = readSshCredentials(cfg);
    if (!credentials.length) {
      const openSettings = vscode.l10n.t("Open Settings");
      const pick = await vscode.window.showErrorMessage(
        vscode.l10n.t("No SSH credentials configured (maixcode.sshCredentials)."),
        openSettings
      );
      if (pick === openSettings) {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "maixcode.sshCredentials"
        );
      }
      return;
    }

    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    const hidePatterns = cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []);
    const showFiltered = cfg.get<boolean>(ConfigKeys.sftpShowFiltered, false);
    const filter = compileSftpHidePatterns(hidePatterns);
    const bookmarks = readSftpBookmarks(cfg);
    // Virtual workspace root is always `/` (bookmark list)
    const virtualRoot = "/";

    const authority = sanitizeAuthority(
      (req.deviceName || "").trim() || host
    );

    // Already mounted & healthy for this authority/host → skip
    const existing = this.fs.getMount(authority);
    if (
      existing &&
      existing.host === host &&
      existing.session.isConnected
    ) {
      existing.bookmarks = bookmarks;
      if (!req.quiet) {
        const folderUri = buildSftpUri(authority, virtualRoot);
        await this.ensureWorkspaceFolder(
          folderUri,
          `MaixSFTP: ${req.deviceName || host}`
        );
        await vscode.commands.executeCommand("revealInExplorer", folderUri);
      }
      log(`[SFTP] already open authority=${authority} host=${host}`);
      return;
    }

    const quiet = !!req.quiet;
    await vscode.window.withProgress(
      {
        location: quiet
          ? vscode.ProgressLocation.Window
          : vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("SFTP: connecting {0}...", host),
        cancellable: false,
      },
      async () => {
        if (existing) {
          this.fs.unregisterMount(authority);
        }

        const session = new SftpSession();
        try {
          await session.ensureConnected({
            host,
            port,
            timeoutMs,
            credentials,
            onProgress: (line) => log(`[SFTP] ${line}`),
          });

          this.fs.registerMount({
            authority,
            host,
            port,
            timeoutMs,
            credentials,
            remoteRoot: virtualRoot,
            deviceName: req.deviceName,
            session,
            filter,
            readOnly,
            showFiltered,
            bookmarks,
          });
          this.persistMounts();

          const folderUri = buildSftpUri(authority, virtualRoot);
          const name = `MaixSFTP: ${req.deviceName || host}`;
          await this.ensureWorkspaceFolder(folderUri, name);
          if (!quiet) {
            await vscode.commands.executeCommand("revealInExplorer", folderUri);
            vscode.window.showInformationMessage(vscode.l10n.t("Opened {0}", name));
          }
          log(
            `[SFTP] opened ${folderUri.toString()} bookmarks=${bookmarks
              .map((b) => b.name)
              .join(",")}${quiet ? " (auto)" : ""}`
          );
        } catch (e) {
          session.dispose();
          if (quiet) {
            error(`[SFTP] auto-open failed: ${formatUnknown(e)}`);
          } else {
            error(`[SFTP] open failed: ${formatUnknown(e)}`, true);
          }
          throw e;
        }
      }
    );
  }

  /**
   * Mount SFTP for each connected device when maixcode.autoOpenSftp is true.
   * Idempotent; skips hosts already mounted or in-flight.
   */
  tryAutoOpenFromConnected(
    devices: Array<{ host: string; deviceName?: string }>
  ): void {
    if (this.disposed) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    if (!cfg.get<boolean>(ConfigKeys.autoOpenSftp, true)) {
      return;
    }
    for (const d of devices) {
      const host = (d.host || "").trim();
      if (!host) {
        continue;
      }
      const authority = sanitizeAuthority(
        (d.deviceName || "").trim() || host
      );
      const mount = this.fs.getMount(authority);
      if (mount && mount.host === host && mount.session.isConnected) {
        continue;
      }
      // same host under different authority
      if (
        this.fs
          .listMounts()
          .some((m) => m.host === host && m.session.isConnected)
      ) {
        continue;
      }
      if (this.autoOpenInFlight.has(host)) {
        continue;
      }
      this.autoOpenInFlight.add(host);
      void this.open({
        host,
        deviceName: d.deviceName,
        quiet: true,
      })
        .catch((e) => {
          log(`[SFTP] tryAutoOpen skip ${host}: ${formatUnknown(e)}`);
        })
        .finally(() => {
          this.autoOpenInFlight.delete(host);
        });
    }
  }

  /**
   * Add path (or basename) to maixcode.sftpHidePatterns and refresh Explorer.
   */
  async filterUri(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== SftpFileSystemProvider.scheme) {
      vscode.window.showErrorMessage(vscode.l10n.t("Not a MaixSFTP path"));
      return;
    }
    const remote = this.fs.remotePathOf(uri);
    const basename = remote.split("/").filter(Boolean).pop() || remote;
    const pattern = patternForPath(remote, basename);

    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const list = [
      ...(cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []) || []),
    ];
    if (list.some((p) => p === pattern || p === basename)) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("Already filtered: {0}", pattern)
      );
      return;
    }
    list.push(pattern);
    const show = cfg.get<boolean>(ConfigKeys.sftpShowFiltered, false);
    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    // Apply immediately (settings event can lag); then persist.
    this.fs.applyFilterState({ patterns: list, readOnly, showFiltered: show });
    this.fs.refreshUri(uri, show ? "change" : "hide");
    this.decorations.refresh(uri);
    await cfg.update(
      ConfigKeys.sftpHidePatterns,
      list,
      vscode.ConfigurationTarget.Global
    );
    this.fs.applyFilterState({ patterns: list, readOnly, showFiltered: show });
    this.fs.refreshUri(uri, show ? "change" : "hide");
    this.decorations.refresh();
    void vscode.commands.executeCommand(
      "workbench.files.action.refreshFilesExplorer"
    );
    log(`[SFTP] filter added: ${pattern}`);
    if (!show) {
      const showFilteredItems = vscode.l10n.t("Show Filtered Items");
      const editPatterns = vscode.l10n.t("Edit Patterns");
      const pick = await vscode.window.showInformationMessage(
        vscode.l10n.t('Filtered "{0}" (pattern: {1}). Hidden in Explorer.', basename, pattern),
        showFilteredItems,
        editPatterns
      );
      if (pick === showFilteredItems) {
        this.fs.applyFilterState({
          patterns: list,
          readOnly,
          showFiltered: true,
        });
        this.fs.refreshUri(uri, "show");
        this.decorations.refresh(uri);
        await cfg.update(
          ConfigKeys.sftpShowFiltered,
          true,
          vscode.ConfigurationTarget.Global
        );
        this.fs.applyFilterState({
          patterns: list,
          readOnly,
          showFiltered: true,
        });
        this.fs.notifyExplorerRefresh(true);
        this.decorations.refresh();
        void vscode.commands.executeCommand(
          "workbench.files.action.refreshFilesExplorer"
        );
      } else if (pick === editPatterns) {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "maixcode.sftpHidePatterns"
        );
      }
    } else {
      vscode.window.showInformationMessage(
        vscode.l10n.t('Filtered "{0}" — badge "H" marks filtered items.', basename)
      );
    }
  }

  async unfilterUri(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== SftpFileSystemProvider.scheme) {
      vscode.window.showErrorMessage(vscode.l10n.t("Not a MaixSFTP path"));
      return;
    }
    const remote = normalizeRemotePath(this.fs.remotePathOf(uri));
    const basename = remote.split("/").filter(Boolean).pop() || remote;
    const match = this.fs.getFilterMatch(uri);

    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const list = [
      ...(cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []) || []),
    ];
    const next = list.filter((p) => {
      const t = (p || "").trim();
      if (!t) {
        return false;
      }
      if (match && t === match) {
        return false;
      }
      if (t === remote || t === basename) {
        return false;
      }
      return true;
    });
    let finalPatterns: string[];
    if (next.length === list.length) {
      if (!list.length) {
        vscode.window.showInformationMessage(vscode.l10n.t("No filter patterns configured."));
        return;
      }
      const picked = await vscode.window.showQuickPick(list, {
        title: vscode.l10n.t("Remove filter pattern"),
        placeHolder: vscode.l10n.t("Select pattern to remove"),
      });
      if (!picked) {
        return;
      }
      finalPatterns = list.filter((p) => p !== picked);
    } else {
      finalPatterns = next;
    }

    const show = cfg.get<boolean>(ConfigKeys.sftpShowFiltered, false);
    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    this.fs.applyFilterState({
      patterns: finalPatterns,
      readOnly,
      showFiltered: show,
    });
    this.fs.refreshUri(uri, "show");
    this.decorations.refresh(uri);

    await cfg.update(
      ConfigKeys.sftpHidePatterns,
      finalPatterns,
      vscode.ConfigurationTarget.Global
    );
    this.fs.applyFilterState({
      patterns: finalPatterns,
      readOnly,
      showFiltered: show,
    });
    this.fs.refreshUri(uri, "show");
    this.decorations.refresh();
    void vscode.commands.executeCommand(
      "workbench.files.action.refreshFilesExplorer"
    );
    vscode.window.showInformationMessage(
      vscode.l10n.t(
        "Unfiltered: {0}{1}",
        basename,
        match ? vscode.l10n.t(" (was {0})", match) : ""
      )
    );
  }

  async toggleShowFiltered(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const cur = cfg.get<boolean>(ConfigKeys.sftpShowFiltered, false);
    const nextVal = !cur;
    const patterns =
      cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []) || [];
    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    this.fs.applyFilterState({
      patterns,
      readOnly,
      showFiltered: nextVal,
    });
    this.fs.notifyExplorerRefresh(true);
    this.decorations.refresh();
    await cfg.update(
      ConfigKeys.sftpShowFiltered,
      nextVal,
      vscode.ConfigurationTarget.Global
    );
    this.fs.applyFilterState({
      patterns,
      readOnly,
      showFiltered: nextVal,
    });
    this.fs.notifyExplorerRefresh(true);
    this.decorations.refresh();
    void vscode.commands.executeCommand(
      "workbench.files.action.refreshFilesExplorer"
    );
    vscode.window.showInformationMessage(
      nextVal
        ? vscode.l10n.t('Show Filtered Items: ON (filtered entries show badge "H")')
        : vscode.l10n.t("Show Filtered Items: OFF (filtered entries hidden)")
    );
  }

  async editFilterPatterns(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "maixcode.sftpHidePatterns"
    );
  }

  /**
   * Refresh Explorer listing for a path or all SFTP mounts.
   * Does not re-auth; re-triggers readDirectory via onDidChangeFile.
   */
  refresh(uri?: vscode.Uri): void {
    if (uri && uri.scheme === SftpFileSystemProvider.scheme) {
      this.fs.refreshUri(uri, "change");
      this.decorations.refresh(uri);
      void vscode.commands.executeCommand(
        "workbench.files.action.refreshFilesExplorer"
      );
      log(`[SFTP] refresh ${uri.toString()}`);
      return;
    }
    this.fs.notifyExplorerRefresh(true);
    this.decorations.refresh();
    void vscode.commands.executeCommand(
      "workbench.files.action.refreshFilesExplorer"
    );
    log("[SFTP] refresh all mounts");
  }

  /**
   * Rebuild a live mount for authority (reload / reconnect).
   * Uses persisted meta + current sshCredentials settings.
   */
  async remountAuthority(authority: string): Promise<SftpMount | undefined> {
    if (this.disposed) {
      return undefined;
    }
    const existing = this.fs.getMount(authority);
    if (existing?.session.isConnected) {
      return existing;
    }
    if (existing) {
      this.fs.unregisterMount(authority);
    }

    const meta = this.findPersistedMount(authority);
    if (!meta) {
      // Try workspace folder URI for path/host hints
      const folder = (vscode.workspace.workspaceFolders ?? []).find(
        (f) =>
          f.uri.scheme === SftpFileSystemProvider.scheme &&
          f.uri.authority === authority
      );
      if (!folder) {
        log(`[SFTP] remount: no meta for ${authority}`);
        return undefined;
      }
      return this.remountFromWorkspaceFolder(folder.uri, authority);
    }

    return this.openQuietMount({
      authority: meta.authority,
      host: meta.host,
      port: meta.port,
      remoteRoot: meta.remoteRoot,
      deviceName: meta.deviceName,
    });
  }

  /**
   * On activation: reconnect any maixsftp workspace folders / persisted mounts.
   */
  async restorePersistedMounts(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const fromState = this.readPersistedMounts();
    const fromWs = (vscode.workspace.workspaceFolders ?? [])
      .filter((f) => f.uri.scheme === SftpFileSystemProvider.scheme)
      .map((f) => f.uri.authority)
      .filter(Boolean);

    const authorities = new Set<string>([
      ...fromState.map((m) => m.authority),
      ...fromWs,
    ]);
    if (!authorities.size) {
      return;
    }
    log(
      `[SFTP] restore mounts: ${[...authorities].join(", ") || "(none)"}`
    );

    for (const authority of authorities) {
      try {
        const mount = await this.remountAuthority(authority);
        if (mount) {
          log(
            `[SFTP] restored ${authority} host=${mount.host} root=${mount.remoteRoot}`
          );
        } else {
          warnRestore(authority);
        }
      } catch (e) {
        error(`[SFTP] restore ${authority}: ${formatUnknown(e)}`);
      }
    }
    this.fs.notifyExplorerRefresh(true);
    this.decorations.refresh();
    void vscode.commands.executeCommand(
      "workbench.files.action.refreshFilesExplorer"
    );
  }

  private async remountFromWorkspaceFolder(
    folderUri: vscode.Uri,
    authority: string
  ): Promise<SftpMount | undefined> {
    // authority is usually device name; host may be IP if that was used
    // Workspace folder only knows authority; host may equal authority (IP or mDNS name)
    const hostGuess = authority;
    const remoteRoot = normalizeRoot(folderUri.path || "/");
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const port = cfg.get<number>(ConfigKeys.sshPort, 22);
    return this.openQuietMount({
      authority,
      host: hostGuess,
      port,
      remoteRoot,
      deviceName: authority,
    });
  }

  private async openQuietMount(meta: {
    authority: string;
    host: string;
    port: number;
    remoteRoot: string;
    deviceName?: string;
  }): Promise<SftpMount | undefined> {
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const timeoutMs = cfg.get<number>(ConfigKeys.sshConnectTimeoutMs, 10000);
    const credentials = readSshCredentials(cfg);
    if (!credentials.length) {
      log("[SFTP] remount skipped: no credentials");
      return undefined;
    }
    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    const hidePatterns = cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []) || [];
    const showFiltered = cfg.get<boolean>(ConfigKeys.sftpShowFiltered, false);
    const filter = compileSftpHidePatterns(hidePatterns);

    let host = (meta.host || "").trim();
    // If host looks like a hostname from mDNS name, try connected devices later via open()
    if (!host) {
      return undefined;
    }

    const session = new SftpSession();
    try {
      await session.ensureConnected({
        host,
        port: meta.port,
        timeoutMs,
        credentials,
        onProgress: (line) => log(`[SFTP] ${line}`),
      });
      let resolved = meta.remoteRoot || "/";
      try {
        resolved = await session.realpath(resolved);
      } catch {
        // keep configured root
      }
      const bookmarks = readSftpBookmarks(cfg);
      const mount: SftpMount = {
        authority: meta.authority,
        host,
        port: meta.port,
        timeoutMs,
        credentials,
        remoteRoot: "/",
        deviceName: meta.deviceName,
        session,
        filter,
        readOnly,
        showFiltered,
        bookmarks,
      };
      this.fs.registerMount(mount);
      this.persistMounts();
      // Ensure workspace folder still present (virtual root)
      await this.ensureWorkspaceFolder(
        buildSftpUri(meta.authority, "/"),
        `MaixSFTP: ${meta.deviceName || host}`
      );
      return mount;
    } catch (e) {
      session.dispose();
      // If authority was device name but host wrong, try open() with host only fails —
      // leave for tryAutoOpenFromConnected when device reconnects.
      log(
        `[SFTP] openQuietMount failed ${meta.authority}@${host}: ${formatUnknown(e)}`
      );
      return undefined;
    }
  }

  private persistMounts(): void {
    const list: PersistedSftpMount[] = this.fs.listMounts().map((m) => ({
      authority: m.authority,
      host: m.host,
      port: m.port,
      remoteRoot: m.remoteRoot,
      deviceName: m.deviceName,
    }));
    // merge workspace-only authorities already in state if still in folders
    void this.context.globalState.update(SftpMountsStateKey, list);
  }

  private readPersistedMounts(): PersistedSftpMount[] {
    const raw = this.context.globalState.get<unknown>(SftpMountsStateKey, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: PersistedSftpMount[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const o = item as Record<string, unknown>;
      const authority =
        typeof o.authority === "string" ? o.authority.trim() : "";
      const host = typeof o.host === "string" ? o.host.trim() : "";
      if (!authority || !host) {
        continue;
      }
      out.push({
        authority,
        host,
        port: typeof o.port === "number" ? o.port : 22,
        remoteRoot:
          typeof o.remoteRoot === "string" ? o.remoteRoot : "/",
        deviceName:
          typeof o.deviceName === "string" ? o.deviceName : undefined,
      });
    }
    return out;
  }

  private findPersistedMount(
    authority: string
  ): PersistedSftpMount | undefined {
    return this.readPersistedMounts().find((m) => m.authority === authority);
  }

  dispose(): void {
    this.disposed = true;
    this.persistMounts();
    this.fs.dispose();
  }

  private ensureProviderRegistered(): void {
    if (this.providerRegistered) {
      return;
    }
    this.context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(
        SftpFileSystemProvider.scheme,
        this.fs,
        {
          isCaseSensitive: true,
          isReadonly: false,
        }
      )
    );
    this.providerRegistered = true;
  }

  private async ensureWorkspaceFolder(
    uri: vscode.Uri,
    name: string
  ): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const idx = folders.findIndex(
      (f) =>
        f.uri.scheme === uri.scheme &&
        f.uri.authority === uri.authority &&
        f.uri.path === uri.path
    );
    if (idx >= 0) {
      return;
    }
    const stale = folders.findIndex(
      (f) =>
        f.uri.scheme === uri.scheme && f.uri.authority === uri.authority
    );
    if (stale >= 0) {
      const ok = vscode.workspace.updateWorkspaceFolders(stale, 1, {
        uri,
        name,
      });
      if (!ok) {
        warnUpdateFailed();
      }
      return;
    }
    const start = folders.length;
    const ok = vscode.workspace.updateWorkspaceFolders(start, 0, {
      uri,
      name,
    });
    if (!ok) {
      warnUpdateFailed();
    }
  }
}

function warnUpdateFailed(): void {
  vscode.window.showWarningMessage(
    vscode.l10n.t("Could not add SFTP folder to workspace. Open the URI from the command palette if needed.")
  );
}

function normalizeRoot(root: string): string {
  let r = (root || "/").trim().replace(/\\/g, "/");
  if (!r.startsWith("/")) {
    r = "/" + r;
  }
  if (r.length > 1 && r.endsWith("/")) {
    r = r.slice(0, -1);
  }
  return r || "/";
}

function sanitizeAuthority(s: string): string {
  return (
    s
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._\-:]/g, "_")
      .slice(0, 64) || "device"
  );
}

function warnRestore(authority: string): void {
  log(
    `[SFTP] could not restore mount ${authority} (device offline or credentials?). Folder stays until reconnect.`
  );
}
