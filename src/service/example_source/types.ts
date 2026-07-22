import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

export type ExampleSourceType = "sipeed" | "local_folder" | "github_repo";

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
      type: "local_folder";
      label?: string;
      /** Local folder path (absolute, ~/..., or ${workspaceFolder}/...) */
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

/**
 * Resolve user-configured filesystem paths:
 * - ${workspaceFolder} / ${workspaceFolder:Name}
 * - ~/... and ~user/...
 * - file:// URIs
 * - relative paths -> against first workspace folder when present
 */
export function resolveUserPath(input: string): string {
  let p = (input || "").trim();
  if (!p) {
    return p;
  }

  // file:// URI
  if (p.startsWith("file://")) {
    try {
      p = vscode.Uri.parse(p).fsPath;
    } catch {
      // keep original
    }
  }

  // ${workspaceFolder} and ${workspaceFolder:folderName}
  const folders = vscode.workspace.workspaceFolders ?? [];
  p = p.replace(/\$\{workspaceFolder(?::([^}]+))?\}/g, (_m, name: string | undefined) => {
    if (name) {
      const match = folders.find((f) => f.name === name);
      return match?.uri.fsPath ?? "";
    }
    return folders[0]?.uri.fsPath ?? "";
  });

  // Expand ~
  if (p === "~") {
    p = os.homedir();
  } else if (p.startsWith("~/") || p.startsWith("~\\")) {
    p = path.join(os.homedir(), p.slice(2));
  } else if (/^~[^/\\]/.test(p)) {
    // ~otheruser/path — best-effort: only support current user style on this OS
    // Leave as-is if not ~/
  }

  // Normalize
  p = path.normalize(p);

  // Relative path: resolve against workspace root when available
  if (!path.isAbsolute(p) && folders[0]) {
    p = path.resolve(folders[0].uri.fsPath, p);
  } else if (!path.isAbsolute(p)) {
    p = path.resolve(p);
  }

  return p;
}

/** @deprecated use resolveUserPath */
export function resolveWorkspacePath(p: string): string {
  return resolveUserPath(p);
}
