import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";
import { ExampleSource } from "./types";
import { log } from "../../logger";
import { emptyDir, extractZipTo, ensureDir } from "./fs_util";

export class GitHubRepoExampleSource implements ExampleSource {
  readonly type = "github_repo" as const;

  constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly rootDir: string,
    private readonly owner: string,
    private readonly repo: string,
    private readonly ref: string = "main",
    private readonly subdir?: string,
    private readonly token?: string
  ) {}

  async refresh(progress?: (msg: string) => void): Promise<void> {
    // Prefer codeload zipball (works with optional token)
    const zipUrl = `https://codeload.github.com/${this.owner}/${this.repo}/zip/refs/heads/${this.ref}`;
    // Also try tag form if branch fails — callers can set ref to tag name with alternate URL
    progress?.(`Downloading GitHub ${this.owner}/${this.repo}@${this.ref}...`);
    log(`[ExampleSource:${this.id}] download ${zipUrl}`);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "MaixCode-VSCode",
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    let data: ArrayBuffer;
    try {
      const res = await axios.get(zipUrl, {
        responseType: "arraybuffer",
        timeout: 120000,
        headers,
        maxRedirects: 5,
      });
      data = res.data;
    } catch (e) {
      // Fallback: archive by commitish (tags / SHAs)
      const alt = `https://codeload.github.com/${this.owner}/${this.repo}/zip/refs/tags/${this.ref}`;
      log(`[ExampleSource:${this.id}] branch zip failed, try tag ${alt}`);
      try {
        const res = await axios.get(alt, {
          responseType: "arraybuffer",
          timeout: 120000,
          headers,
          maxRedirects: 5,
        });
        data = res.data;
      } catch {
        const alt2 = `https://codeload.github.com/${this.owner}/${this.repo}/zip/${this.ref}`;
        log(`[ExampleSource:${this.id}] try generic ${alt2}`);
        const res = await axios.get(alt2, {
          responseType: "arraybuffer",
          timeout: 120000,
          headers,
          maxRedirects: 5,
        });
        data = res.data;
      }
    }

    const zip = await new JSZip().loadAsync(data);
    const tmpRoot = this.rootDir + ".__tmp";
    await emptyDir(tmpRoot);
    ensureDir(tmpRoot);
    progress?.(`Extracting ${this.label}...`);
    await extractZipTo(zip, tmpRoot);

    // GitHub zips wrap content in `<repo>-<ref>/...`
    const top = fs.readdirSync(tmpRoot).filter((n) => !n.startsWith("."));
    let contentRoot = tmpRoot;
    if (top.length === 1) {
      const only = path.join(tmpRoot, top[0]);
      if (fs.statSync(only).isDirectory()) {
        contentRoot = only;
      }
    }
    if (this.subdir) {
      const sub = path.join(contentRoot, this.subdir);
      if (!fs.existsSync(sub)) {
        await emptyDir(tmpRoot);
        throw new Error(
          `GitHub subdir not found: ${this.subdir} in ${this.owner}/${this.repo}`
        );
      }
      contentRoot = sub;
    }

    await emptyDir(this.rootDir);
    ensureDir(this.rootDir);
    await copyRecursive(contentRoot, this.rootDir);
    await emptyDir(tmpRoot);
    try {
      fs.rmdirSync(tmpRoot);
    } catch {
      // ignore
    }
    log(`[ExampleSource:${this.id}] refresh done -> ${this.rootDir}`);
  }
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  ensureDir(dest);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyRecursive(s, d);
    } else if (ent.isFile()) {
      await fs.promises.copyFile(s, d);
    }
  }
}
