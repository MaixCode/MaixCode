import * as vscode from "vscode";
import { ConfigKeys, ConfigSection } from "../../constants";
import { error, formatUnknown, log } from "../../logger";
import { readSshCredentials } from "./credentials";
import { compileSftpHidePatterns } from "./sftp_path_filter";
import { SftpSession } from "./sftp_session";
import {
  buildSftpUri,
  SftpFileSystemProvider,
} from "../../ui/provider/sftp_fs";

export type OpenSftpRequest = {
  host: string;
  deviceName?: string;
  port?: number;
};

/**
 * Manages SFTP mounts + FileSystemProvider registration.
 * One long-lived connection per device authority (separate from shell).
 */
export class SftpService {
  private readonly fs: SftpFileSystemProvider;
  private disposed = false;
  private providerRegistered = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.fs = new SftpFileSystemProvider();
    this.ensureProviderRegistered();
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.sftpHidePatterns}`
          ) ||
          e.affectsConfiguration(
            `${ConfigSection}.${ConfigKeys.sftpReadOnly}`
          )
        ) {
          this.fs.reloadFiltersFromConfig();
        }
      })
    );
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
      vscode.window.showErrorMessage("No device IP for SFTP");
      return;
    }

    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const port = req.port ?? cfg.get<number>(ConfigKeys.sshPort, 22);
    const timeoutMs = cfg.get<number>(ConfigKeys.sshConnectTimeoutMs, 10000);
    const credentials = readSshCredentials(cfg);
    if (!credentials.length) {
      const pick = await vscode.window.showErrorMessage(
        "No SSH credentials configured (maixcode.sshCredentials).",
        "Open Settings"
      );
      if (pick === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "maixcode.sshCredentials"
        );
      }
      return;
    }

    const remoteRoot = normalizeRoot(
      cfg.get<string>(ConfigKeys.sftpRoot, "/")
    );
    const readOnly = cfg.get<boolean>(ConfigKeys.sftpReadOnly, false);
    const hidePatterns = cfg.get<string[]>(ConfigKeys.sftpHidePatterns, []);
    const filter = compileSftpHidePatterns(hidePatterns);

    const authority = sanitizeAuthority(
      (req.deviceName || "").trim() || host
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `SFTP: connecting ${host}...`,
        cancellable: false,
      },
      async () => {
        const existing = this.fs.getMount(authority);
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
          const resolved = await session.realpath(remoteRoot);
          const st = await session.stat(resolved);
          if (!st.isDirectory()) {
            throw new Error(`sftpRoot is not a directory: ${resolved}`);
          }

          this.fs.registerMount({
            authority,
            host,
            port,
            timeoutMs,
            credentials,
            remoteRoot: resolved,
            deviceName: req.deviceName,
            session,
            filter,
            readOnly,
          });

          const folderUri = buildSftpUri(authority, resolved);
          const name = `MaixSFTP: ${req.deviceName || host}`;
          await this.ensureWorkspaceFolder(folderUri, name);
          await vscode.commands.executeCommand("revealInExplorer", folderUri);
          log(`[SFTP] opened ${folderUri.toString()}`);
          vscode.window.showInformationMessage(`Opened ${name}`);
        } catch (e) {
          session.dispose();
          error(`[SFTP] open failed: ${formatUnknown(e)}`, true);
          throw e;
        }
      }
    );
  }

  dispose(): void {
    this.disposed = true;
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
    "Could not add SFTP folder to workspace. Open the URI from the command palette if needed."
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
