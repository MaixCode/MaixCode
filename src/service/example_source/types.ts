import * as vscode from "vscode";

export type ExampleSourceType = "sipeed" | "localfile" | "github_repo";

/** User-facing config entry (package.json / settings). */
export type ExampleSourceConfig =
  | {
      id: string;
      type: "sipeed";
      label?: string;
      baseUrl?: string;
    }
  | {
      id: string;
      type: "localfile";
      label?: string;
      /** Absolute path or ${workspaceFolder}/... */
      path: string;
    }
  | {
      id: string;
      type: "github_repo";
      label?: string;
      owner: string;
      repo: string;
      /** Branch, tag, or commit (default: main) */
      ref?: string;
      /** Optional subdirectory inside the repo to expose */
      subdir?: string;
      /** Optional GitHub token (or use maixcode.githubToken) */
      token?: string;
    };

export interface ExampleSource {
  readonly id: string;
  readonly type: ExampleSourceType;
  readonly label: string;
  /**
   * Absolute directory that will appear under the Example tree as this source's root.
   * Refresh should populate this directory.
   */
  readonly rootDir: string;
  /** Sync/download content into rootDir. */
  refresh(progress?: (msg: string) => void): Promise<void>;
}

export function resolveWorkspacePath(p: string): string {
  if (!p.includes("${workspaceFolder}")) {
    return p;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return p.replace(/\$\{workspaceFolder\}/g, "");
  }
  return p.replace(/\$\{workspaceFolder\}/g, folder);
}
