/**
 * Hide / mark remote paths in SFTP Explorer listings.
 * Each pattern is either:
 * - a glob (* ? ** ; / path sep)
 * - or a JS regex literal: /pattern/flags
 *
 * Matching uses both the basename and the full POSIX remote path.
 */

export type CompiledSftpFilter = {
  /** true if the entry matches a hide/filter pattern */
  shouldHide: (remotePath: string, basename: string) => boolean;
  /** matching pattern string, or undefined */
  matchPattern: (remotePath: string, basename: string) => string | undefined;
  patterns: string[];
};

export function compileSftpHidePatterns(
  patterns: string[] | undefined
): CompiledSftpFilter {
  const rawList = (patterns ?? [])
    .map((p) => (p || "").trim())
    .filter((p) => p.length > 0);

  const compiled: Array<{
    raw: string;
    kind: "glob" | "regex";
    re?: RegExp;
    glob?: string;
  }> = [];

  for (const p of rawList) {
    const regexLit = tryParseRegexLiteral(p);
    if (regexLit) {
      compiled.push({ raw: p, kind: "regex", re: regexLit });
      continue;
    }
    compiled.push({ raw: p, kind: "glob", glob: p });
  }

  const matchPattern = (
    remotePath: string,
    basename: string
  ): string | undefined => {
    if (!compiled.length) {
      return undefined;
    }
    const full = normalizeRemotePath(remotePath);
    for (const c of compiled) {
      if (c.kind === "regex" && c.re) {
        if (c.re.test(basename) || c.re.test(full)) {
          return c.raw;
        }
        continue;
      }
      if (c.glob && matchGlob(c.glob, basename, full)) {
        return c.raw;
      }
    }
    return undefined;
  };

  return {
    patterns: rawList,
    matchPattern,
    shouldHide(remotePath: string, basename: string): boolean {
      return matchPattern(remotePath, basename) !== undefined;
    },
  };
}

/** Prefer exact full path; fall back to basename for simple names. */
export function patternForPath(remotePath: string, basename: string): string {
  const full = normalizeRemotePath(remotePath);
  // Prefer full path for directories so only that node is filtered
  if (full && full !== "/") {
    return full;
  }
  return basename;
}

export function normalizeRemotePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  if (!s.startsWith("/")) {
    s = "/" + s;
  }
  s = s.replace(/\/+/g, "/");
  if (s.length > 1 && s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  return s;
}

function tryParseRegexLiteral(s: string): RegExp | undefined {
  if (s.length < 2 || s[0] !== "/") {
    return undefined;
  }
  const last = s.lastIndexOf("/");
  if (last <= 0) {
    return undefined;
  }
  const body = s.slice(1, last);
  const flags = s.slice(last + 1);
  if (!/^[gimsuy]*$/.test(flags)) {
    return undefined;
  }
  try {
    return new RegExp(body, flags);
  } catch {
    return undefined;
  }
}

function matchGlob(
  pattern: string,
  basename: string,
  fullPath: string
): boolean {
  const pat = pattern.replace(/\\/g, "/");
  if (!pat.includes("/")) {
    const re = globToRegExp(pat);
    return re.test(basename);
  }
  const re = globToRegExp(pat);
  return re.test(fullPath) || re.test(basename);
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (".+^${}()|[]\\".includes(ch)) {
      out += "\\" + ch;
      continue;
    }
    out += ch;
  }
  out += "$";
  try {
    return new RegExp(out, "i");
  } catch {
    return /^$/;
  }
}
