import * as vscode from "vscode";
import { SftpFileSystemProvider } from "./sftp_fs";

/**
 * Badge + tooltip for SFTP entries that match hide/filter patterns.
 * Only meaningful when maixcode.sftpShowFiltered is true (items remain in list).
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
