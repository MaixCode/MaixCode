import * as path from "path";
import * as vscode from "vscode";
import { ExampleSource, ExampleSourceConfig } from "./types";
import { SipeedCdnExampleSource } from "./sipeed_source";
import { LocalFileExampleSource } from "./local_source";
import { GitHubRepoExampleSource } from "./github_source";
import { ensureDir } from "./fs_util";
import { log, warn } from "../../logger";

const DEFAULT_SOURCES: ExampleSourceConfig[] = [
  {
    id: "sipeed",
    type: "sipeed",
    label: "Official",
  },
];

export function loadExampleSourceConfigs(): ExampleSourceConfig[] {
  const cfg = vscode.workspace.getConfiguration("maixcode");
  const raw = cfg.get<ExampleSourceConfig[]>("exampleSources");
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_SOURCES.slice();
  }
  // Validate minimally and skip invalid entries
  const out: ExampleSourceConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || !item.id || !item.type) {
      warn(`[ExampleRegistry] skip invalid source entry: ${JSON.stringify(item)}`);
      continue;
    }
    if (seen.has(item.id)) {
      warn(`[ExampleRegistry] duplicate source id ${item.id}, skip`);
      continue;
    }
    // Sanitize id for filesystem
    if (!/^[a-zA-Z0-9._-]+$/.test(item.id)) {
      warn(`[ExampleRegistry] invalid source id ${item.id}, skip`);
      continue;
    }
    seen.add(item.id);
    // Normalize legacy type name
    const normalized = { ...item } as ExampleSourceConfig & { type: string };
    if ((normalized as { type: string }).type === "localfile") {
      (normalized as { type: string }).type = "local_folder";
    }
    out.push(normalized as ExampleSourceConfig);
  }
  return out.length ? out : DEFAULT_SOURCES.slice();
}

export function createExampleSources(
  cacheDir: string,
  configs?: ExampleSourceConfig[]
): ExampleSource[] {
  const list = configs ?? loadExampleSourceConfigs();
  const sourcesRoot = path.join(cacheDir, "sources");
  ensureDir(sourcesRoot);
  const globalToken =
    vscode.workspace.getConfiguration("maixcode").get<string>("githubToken") ||
    undefined;

  const sources: ExampleSource[] = [];
  for (const c of list) {
    const rootDir = path.join(sourcesRoot, c.id);
    ensureDir(rootDir);
    try {
      switch (c.type) {
        case "sipeed":
          sources.push(
            new SipeedCdnExampleSource(
              c.id,
              c.label || "Official",
              rootDir,
              c.baseUrl
            )
          );
          break;
        case "local_folder": {
          const local = c as { path?: string; id: string; label?: string };
          if (!local.path) {
            warn(`[ExampleRegistry] local_folder ${c.id} missing path`);
            break;
          }
          sources.push(
            new LocalFileExampleSource(
              c.id,
              c.label || c.id,
              rootDir,
              local.path
            )
          );
          break;
        }
        case "github_repo":
          if (!c.owner || !c.repo) {
            warn(`[ExampleRegistry] github_repo ${c.id} missing owner/repo`);
            break;
          }
          sources.push(
            new GitHubRepoExampleSource(
              c.id,
              c.label || `${c.owner}/${c.repo}`,
              rootDir,
              c.owner,
              c.repo,
              c.ref || "main",
              c.subdir,
              c.token || globalToken
            )
          );
          break;
        default:
          warn(`[ExampleRegistry] unknown type on ${JSON.stringify(c)}`);
      }
    } catch (e) {
      warn(`[ExampleRegistry] failed to create source ${c.id}: ${e}`);
    }
  }
  log(
    `[ExampleRegistry] sources: ${sources.map((s) => `${s.id}(${s.type})`).join(", ")}`
  );
  return sources;
}
