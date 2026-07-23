import * as vscode from "vscode";
import { SftpFileSystemProvider } from "./sftp_fs";

/**
 * Explorer decorations for maixsftp:
 * - Bookmark roots: blue label (no badge/icon)
 * - Filtered entries: "H" when showFiltered is on
 */
export class SftpFileDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly _onDidChange = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  constructor(private readonly fs: SftpFileSystemProvider) {}

  provideFileDecoration(
    uri: vscode.Uri
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== SftpFileSystemProvider.scheme) {
      return undefined;
    }
    try {
      const mapped = this.fs.mapUri(uri);
      if (mapped.kind === "remote" && mapped.isBookmarkRoot) {
        return {
          tooltip: `${mapped.bookmark.name} → ${mapped.bookmark.remotePath}`,
          color: new vscode.ThemeColor("charts.blue"),
          propagate: false,
        };
      }
    } catch {
      // ignore map errors
    }
    const pattern = this.fs.getFilterMatch(uri);
    if (!pattern) {
      return undefined;
    }
    return {
      badge: "H",
      tooltip: `Filtered by MaixCode SFTP — pattern: ${pattern}. Right-click Unfilter to restore.`,
      color: new vscode.ThemeColor("disabledForeground"),
      propagate: false,
    };
  }

  refresh(uris?: vscode.Uri | vscode.Uri[]): void {
    this._onDidChange.fire(uris);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
