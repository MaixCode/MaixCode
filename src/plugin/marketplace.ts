import * as fs from "node:fs/promises";
import * as path from "node:path";
import axios from "axios";
import JSZip from "jszip";
import * as vscode from "vscode";
import { log, warn } from "../logger";
import { PluginStorage } from "./storage";
import { PluginRegistry } from "./registry";
import {
  PluginMarketplaceConfig,
  MarketplaceIndex,
  MarketplacePluginEntry,
  PluginSource,
} from "./marketplace_types";
import { ConfigSection } from "../constants";

const MarketplaceCacheStateKey = "maixcode.marketplaceCache";
const MarketplacesConfigKey = "pluginMarketplaces";

function getConfig(): PluginMarketplaceConfig[] {
  return vscode.workspace.getConfiguration(ConfigSection).get<PluginMarketplaceConfig[]>(MarketplacesConfigKey, []);
}

function githubToken(): string {
  return vscode.workspace.getConfiguration(ConfigSection).get<string>("githubToken", "");
}

export interface InstalledInfo {
  id: string;
  version: string;
}

export interface MarketplaceEntryWithSource {
  entry: MarketplacePluginEntry;
  marketplaceId: string;
}

interface CacheData {
  [marketplaceId: string]: MarketplaceIndex;
}

export class MarketplaceService {
  private readonly cache = new Map<string, MarketplaceIndex>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storage: PluginStorage,
    private readonly registry: PluginRegistry
  ) {
    const saved = this.context.globalState.get<CacheData>(MarketplaceCacheStateKey, {});
    for (const [id, index] of Object.entries(saved)) {
      this.cache.set(id, index);
    }
  }

  public onDidChange(listener: () => void): vscode.Disposable {
    return this.onDidChangeEmitter.event(listener);
  }

  public getConfigs(): PluginMarketplaceConfig[] {
    return getConfig();
  }

  public getCachedIndex(marketplaceId: string): MarketplaceIndex | undefined {
    return this.cache.get(marketplaceId);
  }

  public getAllEntries(): MarketplaceEntryWithSource[] {
    const result: MarketplaceEntryWithSource[] = [];
    for (const [mid, index] of this.cache) {
      for (const entry of index.plugins) {
        result.push({ entry, marketplaceId: mid });
      }
    }
    return result;
  }

  public async refreshIndexes(progress?: (msg: string) => void): Promise<void> {
    const configs = this.getConfigs();
    for (const cfg of configs) {
      try {
        progress?.(`Fetching ${cfg.label}...`);
        const index = await this.fetchIndex(cfg);
        this.cache.set(cfg.id, index);
      } catch (error) {
        warn(`[Marketplace] failed to fetch index ${cfg.id}: ${formatError(error)}`);
      }
    }
    await this.persistCache();
    this.onDidChangeEmitter.fire();
  }

  private async persistCache(): Promise<void> {
    const data: CacheData = {};
    for (const [id, index] of this.cache) {
      data[id] = index;
    }
    await this.context.globalState.update(MarketplaceCacheStateKey, data);
  }

  private async fetchIndex(cfg: PluginMarketplaceConfig): Promise<MarketplaceIndex> {
    if (cfg.type === "github") {
      return this.fetchGithubIndex(cfg);
    }
    return this.fetchHttpIndex(cfg);
  }

  private async fetchGithubIndex(cfg: PluginMarketplaceConfig): Promise<MarketplaceIndex> {
    const owner = cfg.owner || "";
    const repo = cfg.repo || "";
    const indexPath = cfg.path || "marketplace/index.json";
    const ref = cfg.ref || "main";
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${ref}/${indexPath}`;
    const headers: Record<string, string> = { "User-Agent": "MaixCode-VSCode" };
    const token = githubToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await axios.get(rawUrl, { timeout: 30000, headers });
    return normalizeIndex(res.data);
  }

  private async fetchHttpIndex(cfg: PluginMarketplaceConfig): Promise<MarketplaceIndex> {
    if (!cfg.url) {
      throw new Error(`HTTP marketplace ${cfg.id} has no url`);
    }
    const res = await axios.get(cfg.url, { timeout: 30000 });
    return normalizeIndex(res.data);
  }

  public async install(entry: MarketplacePluginEntry): Promise<void> {
    const tmpDir = path.join(this.storage.getRootPath(), `.tmp-${entry.id}`);
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      await this.downloadAndExtract(entry.source, tmpDir, entry.id);
      await this.storage.installFromFolder(tmpDir, entry.id);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Download plugin source to an arbitrary directory (caller is responsible for cleanup). */
  public async downloadTo(entry: MarketplacePluginEntry, targetDir: string): Promise<void> {
    await this.downloadAndExtract(entry.source, targetDir, entry.id);
  }

  private async downloadAndExtract(source: PluginSource, targetDir: string, pluginId: string): Promise<void> {
    switch (source.type) {
      case "path":
        await this.downloadPath(source, targetDir);
        break;
      case "github-repo":
        await this.downloadGithubRepo(source, targetDir);
        break;
      case "github-release":
        await this.downloadGithubRelease(source, targetDir);
        break;
      case "http":
        await this.downloadHttp(source, targetDir);
        break;
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "User-Agent": "MaixCode-VSCode" };
    const token = githubToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async downloadZipAndExtract(url: string, targetDir: string, subdir?: string): Promise<void> {
    const headers = this.getAuthHeaders();
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 120000, headers, maxRedirects: 5 });
    const zip = await new JSZip().loadAsync(res.data);
    const tmp = targetDir + ".__zip";
    await fs.mkdir(tmp, { recursive: true });
    try {
      await extractZipTo(zip, tmp, subdir);
      await copyContents(tmp, targetDir);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async downloadPath(source: PluginSource & { type: "path" }, targetDir: string): Promise<void> {
    const configs = this.getConfigs();
    for (const cfg of configs) {
      const owner = cfg.owner;
      const repo = cfg.repo;
      const ref = cfg.ref || "main";
      if (!owner || !repo) continue;
      const url = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${ref}`;
      try {
        await this.downloadZipAndExtract(url, targetDir, source.path);
        return;
      } catch {
        // try next marketplace that has owner/repo
      }
    }
    throw new Error(`Cannot resolve path source for ${source.path}: no github marketplace config with owner/repo`);
  }

  private async downloadGithubRepo(source: PluginSource & { type: "github-repo" }, targetDir: string): Promise<void> {
    const ref = source.ref || "main";
    const url = `https://codeload.github.com/${source.owner}/${source.repo}/zip/refs/heads/${ref}`;
    try {
      await this.downloadZipAndExtract(url, targetDir, source.path);
    } catch {
      const alt = `https://codeload.github.com/${source.owner}/${source.repo}/zip/refs/tags/${ref}`;
      await this.downloadZipAndExtract(alt, targetDir, source.path);
    }
  }

  private async downloadGithubRelease(source: PluginSource & { type: "github-release" }, targetDir: string): Promise<void> {
    const headers = this.getAuthHeaders();
    headers.Accept = "application/vnd.github+json";
    let releaseUrl: string;
    if (source.release.tag) {
      releaseUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/releases/tags/${source.release.tag}`;
    } else {
      releaseUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/releases/latest`;
    }
    const relRes = await axios.get(releaseUrl, { timeout: 30000, headers });
    const assets: Array<{ name: string; browser_download_url: string }> = relRes.data.assets || [];
    const asset = assets.find((a: { name: string }) => a.name === source.release.asset);
    if (!asset) {
      throw new Error(`Release asset not found: ${source.release.asset}`);
    }
    const dlUrl = asset.browser_download_url;
    await this.downloadZipAndExtract(dlUrl, targetDir);
  }

  private async downloadHttp(source: PluginSource & { type: "http" }, targetDir: string): Promise<void> {
    await this.downloadZipAndExtract(source.url, targetDir);
  }

  public getInstalledMap(): Map<string, InstalledInfo> {
    const map = new Map<string, InstalledInfo>();
    for (const record of this.registry.list()) {
      map.set(record.id, { id: record.id, version: record.manifest.version });
    }
    return map;
  }

  /** IDs of all plugins listed in any marketplace index. */
  public getMarketplacePluginIds(): Set<string> {
    const ids = new Set<string>();
    for (const [, index] of this.cache) {
      for (const entry of index.plugins) {
        ids.add(entry.id);
      }
    }
    return ids;
  }

  public async checkForUpdates(): Promise<MarketplaceEntryWithSource[]> {
    const installed = this.getInstalledMap();
    const result: MarketplaceEntryWithSource[] = [];
    for (const { entry, marketplaceId } of this.getAllEntries()) {
      const current = installed.get(entry.id);
      if (current && compareVersions(current.version, entry.version) < 0) {
        result.push({ entry, marketplaceId });
      }
    }
    return result;
  }
}

function normalizeIndex(raw: unknown): MarketplaceIndex {
  const data = raw as Record<string, unknown>;
  if (typeof data !== "object" || !data) {
    throw new Error("Invalid marketplace index");
  }
  if (data.version !== 1) {
    throw new Error(`Unsupported marketplace index version: ${data.version}`);
  }
  const plugins = data.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error("Marketplace index missing plugins array");
  }
  return {
    version: data.version as number,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
    plugins: plugins as MarketplacePluginEntry[],
  };
}

async function extractZipTo(zip: JSZip, targetDir: string, subdir?: string): Promise<void> {
  let rootDir = targetDir;
  if (subdir) {
    rootDir = path.join(targetDir, "__sub");
    await fs.mkdir(rootDir, { recursive: true });
  }
  const entries: Array<{ path: string; dir: boolean }> = [];
  zip.forEach((relativePath, entry) => {
    const normalized = relativePath.replace(/\\/g, "/");
    if (normalized.startsWith("__MACOSX/")) return;
    entries.push({ path: normalized, dir: entry.dir });
  });
  const commonPrefix = findCommonPrefix(entries.map((e) => e.path));
  for (const entry of entries) {
    const relative = entry.path.startsWith(commonPrefix) ? entry.path.slice(commonPrefix.length) : entry.path;
    if (!relative) continue;
    const target = path.join(rootDir, relative);
    if (entry.dir) {
      await fs.mkdir(target, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const data = zip.file(entry.path);
      if (data) {
        const buf = await data.async("nodebuffer");
        await fs.writeFile(target, buf);
      }
    }
  }
  if (subdir) {
    const subTarget = path.join(rootDir, subdir);
    if (await exists(subTarget)) {
      await copyContents(subTarget, targetDir);
    }
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  }
}

function findCommonPrefix(paths: string[]): string {
  if (!paths.length) return "";
  const parts = paths.map((p) => p.split("/"));
  const minLen = Math.min(...parts.map((p) => p.length));
  const result: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const val = parts[0][i];
    if (parts.every((p) => p[i] === val)) {
      result.push(val);
    } else break;
  }
  return result.length ? result.join("/") + "/" : "";
}

async function copyContents(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyContents(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
