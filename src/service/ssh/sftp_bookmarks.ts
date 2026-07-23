import * as vscode from "vscode";
import { ConfigKeys, ConfigSection } from "../../constants";

export type SftpBookmark = {
  /** Display name (and path segment under virtual root) */
  name: string;
  /** Absolute remote POSIX path */
  remotePath: string;
  order: number;
};

export const DEFAULT_SFTP_BOOKMARKS: SftpBookmark[] = [
  {
    name: "Home",
    remotePath: "/root",
    order: 0,
  },
  {
    name: "Root",
    remotePath: "/",
    order: 1,
  },
];

export function readSftpBookmarks(
  cfg?: vscode.WorkspaceConfiguration
): SftpBookmark[] {
  const c = cfg ?? vscode.workspace.getConfiguration(ConfigSection);
  const raw = c.get<unknown>(ConfigKeys.sftpBookmarks, DEFAULT_SFTP_BOOKMARKS);
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_SFTP_BOOKMARKS];
  }
  const out: SftpBookmark[] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const name = sanitizeBookmarkName(
      typeof o.name === "string" ? o.name : ""
    );
    if (!name || used.has(name.toLowerCase())) {
      continue;
    }
    const remotePath = normalizeRemoteBookmarkPath(
      typeof o.remotePath === "string"
        ? o.remotePath
        : typeof o.remote_path === "string"
          ? o.remote_path
          : ""
    );
    if (!remotePath) {
      continue;
    }
    const order =
      typeof o.order === "number" && Number.isFinite(o.order) ? o.order : 0;
    used.add(name.toLowerCase());
    out.push({ name, remotePath, order });
  }
  if (!out.length) {
    return [...DEFAULT_SFTP_BOOKMARKS];
  }
  out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return out;
}

export function sanitizeBookmarkName(name: string): string {
  return name
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 64);
}

export function normalizeRemoteBookmarkPath(p: string): string {
  let s = (p || "").trim().replace(/\\/g, "/");
  if (!s) {
    return "";
  }
  if (!s.startsWith("/")) {
    s = "/" + s;
  }
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  const parts = s.split("/").filter((x) => x.length > 0 && x !== ".");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length ? "/" + stack.join("/") : "/";
}

/**
 * Map virtual URI path under maixsftp mount to remote path or virtual root.
 * Virtual layout:
 *   /                    -> bookmark list
 *   /<bookmarkName>      -> bookmark.remotePath
 *   /<bookmarkName>/a/b  -> bookmark.remotePath/a/b
 */
export type VirtualPathMap =
  | { kind: "virtual-root" }
  | {
      kind: "remote";
      remotePath: string;
      bookmark: SftpBookmark;
      relative: string;
      isBookmarkRoot: boolean;
    };

export function mapVirtualPath(
  uriPath: string,
  bookmarks: SftpBookmark[]
): VirtualPathMap {
  const path = normalizeVirtualUriPath(uriPath);
  if (path === "/") {
    return { kind: "virtual-root" };
  }
  const parts = path.split("/").filter((p) => p.length > 0);
  const bmName = parts[0];
  const bookmark = bookmarks.find((b) => b.name === bmName);
  if (!bookmark) {
    throw Object.assign(new Error(`Unknown bookmark: ${bmName}`), {
      code: "ENOENT",
    });
  }
  const relativeParts = parts.slice(1);
  const relative = relativeParts.join("/");
  let remotePath = bookmark.remotePath;
  if (relative) {
    remotePath =
      remotePath === "/"
        ? `/${relative}`
        : `${remotePath.replace(/\/$/, "")}/${relative}`;
  }
  return {
    kind: "remote",
    remotePath: normalizeRemoteBookmarkPath(remotePath) || "/",
    bookmark,
    relative,
    isBookmarkRoot: relativeParts.length === 0,
  };
}

export function normalizeVirtualUriPath(path: string): string {
  let p = (path || "/").replace(/\\/g, "/");
  if (!p.startsWith("/")) {
    p = "/" + p;
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  const parts = p.split("/").filter((s) => s.length > 0 && s !== ".");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length ? "/" + stack.join("/") : "/";
}

export function findBookmarkForRemote(
  remotePath: string,
  bookmarks: SftpBookmark[]
): SftpBookmark | undefined {
  const norm = normalizeRemoteBookmarkPath(remotePath);
  let best: SftpBookmark | undefined;
  let bestLen = -1;
  for (const b of bookmarks) {
    const bp = b.remotePath;
    if (
      norm === bp ||
      (bp !== "/" && norm.startsWith(bp + "/")) ||
      (bp === "/" && norm.startsWith("/"))
    ) {
      const len = bp.length;
      if (len > bestLen) {
        best = b;
        bestLen = len;
      }
    }
  }
  return best;
}
