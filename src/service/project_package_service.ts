import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import JSZip from "jszip";
import * as yaml from "yamljs";
import {
  APP_ICON_NAME,
  APP_YAML_NAME,
  AppConfig,
  AppConfigResult,
  isValidAppId,
  isValidAppVersion,
  PackageInfo,
  PackageInfoResult,
  RUN_PROJECT_EXCLUDE_FOLDERS,
} from "../model/app_config";
import { ensureDir } from "./example_source/fs_util";
import { error, formatUnknown, log } from "../logger";

function normalizeFiles(files: unknown): string[] {
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .map((f) => String(f).replace(/\\/g, "/").replace(/^\.?\//, ""))
    .filter((f) => f.length > 0 && !f.includes(".."));
}

function asAppConfig(raw: unknown): AppConfig | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const files = normalizeFiles(o.files);
  return {
    ...o,
    id: typeof o.id === "string" ? o.id : "",
    version: typeof o.version === "string" ? o.version : "",
    name: typeof o.name === "string" ? o.name : "",
    author: typeof o.author === "string" ? o.author : undefined,
    desc: typeof o.desc === "string" ? o.desc : undefined,
    icon: typeof o.icon === "string" ? o.icon : undefined,
    files,
  };
}

function confPath(projectDir: string): string {
  return path.join(projectDir, APP_YAML_NAME);
}

function distDir(projectDir: string): string {
  return path.join(projectDir, "dist");
}

function packageFileName(config: AppConfig): string {
  return `maix-${config.id}-v${config.version}.zip`;
}

function packageFilePath(projectDir: string, config: AppConfig): string {
  return path.join(distDir(projectDir), packageFileName(config));
}

/**
 * Project packaging / app.yaml / install helpers (MaixVision package + RunProject).
 */
export class ProjectPackageService {
  /**
   * Resolve project root: nearest ancestor (or workspace folder) that contains app.yaml,
   * else first workspace folder, else dirname of active file.
   */
  public resolveProjectDir(hint?: string): string | undefined {
    if (hint) {
      const abs = path.resolve(hint);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        return abs;
      }
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return this.findProjectRoot(path.dirname(abs));
      }
    }

    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme === "file") {
      const fromFile = this.findProjectRoot(path.dirname(editor.document.uri.fsPath));
      if (fromFile) {
        return fromFile;
      }
    }

    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      // Prefer a folder that already has app.yaml
      for (const f of folders) {
        if (fs.existsSync(confPath(f.uri.fsPath))) {
          return f.uri.fsPath;
        }
      }
      return folders[0].uri.fsPath;
    }

    if (editor?.document.uri.scheme === "file") {
      return path.dirname(editor.document.uri.fsPath);
    }
    return undefined;
  }

  private findProjectRoot(startDir: string): string | undefined {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;
    while (true) {
      if (fs.existsSync(confPath(dir))) {
        return dir;
      }
      const wf = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir));
      if (wf && path.resolve(wf.uri.fsPath) === dir) {
        return dir;
      }
      if (dir === root) {
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    return startDir;
  }

  public async readConfig(projectDir: string): Promise<AppConfigResult> {
    try {
      const p = confPath(projectDir);
      if (!fs.existsSync(p)) {
        return { ok: true, config: undefined };
      }
      const content = await fs.promises.readFile(p, "utf8");
      const loaded = yaml.parse(content);
      const config = asAppConfig(loaded);
      return { ok: true, config };
    } catch (e) {
      error(`[ProjectPackage] readConfig: ${formatUnknown(e)}`);
      return { ok: false, message: formatUnknown(e) };
    }
  }

  /**
   * Merge partial data into app.yaml (create if missing).
   * Icon data-url is not rewritten to PNG here (optional future); keep path string.
   */
  public async writeConfig(
    projectDir: string,
    data: Partial<AppConfig>
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      ensureDir(projectDir);
      const p = confPath(projectDir);
      let base: Record<string, unknown> = {};
      if (fs.existsSync(p)) {
        const content = await fs.promises.readFile(p, "utf8");
        const old = yaml.parse(content);
        if (old && typeof old === "object") {
          base = { ...(old as Record<string, unknown>) };
        }
      }

      const next: Record<string, unknown> = { ...base, ...data };
      if (data.files) {
        next.files = normalizeFiles(data.files);
      }
      // Absolute single file -> relative
      if (Array.isArray(next.files) && next.files.length === 1) {
        const only = String(next.files[0]);
        if (path.isAbsolute(only)) {
          next.files = [path.relative(projectDir, only).replace(/\\/g, "/")];
        }
      }
      if (typeof next.icon === "string" && next.icon.startsWith("data:")) {
        // Keep existing icon path or default; do not store data-url in yaml
        next.icon =
          typeof base.icon === "string" && base.icon && !String(base.icon).startsWith("data:")
            ? base.icon
            : APP_ICON_NAME;
      }

      const yamlData = yaml.stringify(next);
      await fs.promises.writeFile(p, yamlData, "utf8");
      return { ok: true };
    } catch (e) {
      error(`[ProjectPackage] writeConfig: ${formatUnknown(e)}`);
      return { ok: false, message: formatUnknown(e) };
    }
  }

  public async getPackageInfo(projectDir: string): Promise<PackageInfoResult> {
    const read = await this.readConfig(projectDir);
    if (!read.ok) {
      return read;
    }
    if (!read.config) {
      return { ok: true, config: undefined };
    }
    const filePath = packageFilePath(projectDir, read.config);
    try {
      const stats = await fs.promises.stat(filePath);
      const info: PackageInfo = {
        name: packageFileName(read.config),
        path: filePath,
        size: stats.size,
      };
      return { ok: true, config: read.config, info };
    } catch {
      return { ok: true, config: read.config };
    }
  }

  /**
   * Build dist/maix-{id}-v{version}.zip from app.yaml files list (MaixVision packageApp).
   */
  public async packageApp(
    projectDir: string
  ): Promise<
    | { ok: true; info: PackageInfo; config: AppConfig }
    | { ok: false; message: string }
  > {
    try {
      const read = await this.readConfig(projectDir);
      if (!read.ok) {
        return read;
      }
      const config = read.config;
      if (!config) {
        return { ok: false, message: "app.yaml not found. Configure the project first." };
      }
      if (!config.id || !isValidAppId(config.id)) {
        return {
          ok: false,
          message: "app.yaml id is missing or invalid (must match /^[a-zA-Z][a-zA-Z0-9_]*$/).",
        };
      }
      if (!config.version || !isValidAppVersion(config.version)) {
        return {
          ok: false,
          message: "app.yaml version is missing or invalid (use semver x.y.z).",
        };
      }
      if (!config.files?.length) {
        return {
          ok: false,
          message: "app.yaml has no files list. Add files to package.",
        };
      }

      const zip = new JSZip();
      if (config.files.length === 1) {
        const rel = config.files[0];
        const absolutePath = path.join(projectDir, rel);
        if (!fs.existsSync(absolutePath)) {
          return { ok: false, message: `Package file missing: ${rel}` };
        }
        // Single-file projects are stored as main.py in zip root
        zip.file("main.py", await fs.promises.readFile(absolutePath));
      } else {
        for (const file of config.files) {
          const localPath = path.join(projectDir, file);
          if (!fs.existsSync(localPath)) {
            return { ok: false, message: `Package file missing: ${file}` };
          }
          const data = await fs.promises.readFile(localPath);
          zip.file(file.replace(/\\/g, "/"), data);
        }
      }

      if (!config.files.includes(APP_YAML_NAME)) {
        const absolutePath = confPath(projectDir);
        if (fs.existsSync(absolutePath)) {
          zip.file(APP_YAML_NAME, await fs.promises.readFile(absolutePath));
        }
      }

      if (config.icon) {
        const iconRel = config.icon === APP_ICON_NAME || config.icon.endsWith(APP_ICON_NAME)
          ? APP_ICON_NAME
          : config.icon;
        const absolutePath = path.join(projectDir, iconRel);
        if (fs.existsSync(absolutePath)) {
          zip.file(path.basename(iconRel), await fs.promises.readFile(absolutePath));
        }
      }

      const outDir = distDir(projectDir);
      ensureDir(outDir);
      const target = packageFilePath(projectDir, config);
      const buf = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      await fs.promises.writeFile(target, buf);
      const stats = await fs.promises.stat(target);
      log(`[ProjectPackage] packaged ${target} (${stats.size} bytes)`);
      return {
        ok: true,
        config,
        info: {
          name: packageFileName(config),
          path: target,
          size: stats.size,
        },
      };
    } catch (e) {
      error(`[ProjectPackage] packageApp: ${formatUnknown(e)}`);
      return { ok: false, message: formatUnknown(e) };
    }
  }

  /**
   * Zip entire project folder for RunProject (exclude dist/.git/etc.).
   * Writes under os.tmpdir()/maixcode/{name}.zip
   */
  public async packageFolderForRun(
    projectDir: string,
    excludes: readonly string[] = RUN_PROJECT_EXCLUDE_FOLDERS
  ): Promise<
    | { ok: true; info: PackageInfo }
    | { ok: false; message: string }
  > {
    try {
      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        return { ok: false, message: `Not a directory: ${projectDir}` };
      }
      const zip = new JSZip();
      await this.addDirToZip(zip, projectDir, "", excludes);
      const name = path.basename(projectDir) || "project";
      const outDir = path.join(os.tmpdir(), "maixcode");
      ensureDir(outDir);
      const target = path.join(outDir, `${name}.zip`);
      const buf = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      await fs.promises.writeFile(target, buf);
      const stats = await fs.promises.stat(target);
      log(`[ProjectPackage] run-project zip ${target} (${stats.size} bytes)`);
      return {
        ok: true,
        info: {
          name: path.basename(target),
          path: target,
          size: stats.size,
        },
      };
    } catch (e) {
      error(`[ProjectPackage] packageFolderForRun: ${formatUnknown(e)}`);
      return { ok: false, message: formatUnknown(e) };
    }
  }

  private async addDirToZip(
    zip: JSZip,
    absDir: string,
    zipPrefix: string,
    excludes: readonly string[]
  ): Promise<void> {
    const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (excludes.includes(ent.name)) {
          continue;
        }
        const childAbs = path.join(absDir, ent.name);
        const childPrefix = zipPrefix ? `${zipPrefix}/${ent.name}` : ent.name;
        await this.addDirToZip(zip, childAbs, childPrefix, excludes);
      } else if (ent.isFile()) {
        const childAbs = path.join(absDir, ent.name);
        const zipPath = zipPrefix ? `${zipPrefix}/${ent.name}` : ent.name;
        zip.file(zipPath, await fs.promises.readFile(childAbs));
      }
    }
  }

  public async ensureMainPy(projectDir: string): Promise<boolean> {
    const mainPath = path.join(projectDir, "main.py");
    try {
      const st = await fs.promises.stat(mainPath);
      return st.isFile();
    } catch {
      return false;
    }
  }

  /** Collect relative file paths under project (for default files list). */
  public async listProjectFiles(
    projectDir: string,
    excludes: readonly string[] = RUN_PROJECT_EXCLUDE_FOLDERS
  ): Promise<string[]> {
    const out: string[] = [];
    const walk = async (abs: string, rel: string) => {
      const entries = await fs.promises.readdir(abs, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          if (excludes.includes(ent.name) || ent.name.startsWith(".")) {
            continue;
          }
          await walk(
            path.join(abs, ent.name),
            rel ? `${rel}/${ent.name}` : ent.name
          );
        } else if (ent.isFile()) {
          if (ent.name.startsWith(".")) {
            continue;
          }
          out.push(rel ? `${rel}/${ent.name}` : ent.name);
        }
      }
    };
    await walk(projectDir, "");
    return out;
  }

  /**
   * Interactive configure: QuickInput for id/name/version/author/desc + files.
   * Writes app.yaml. Returns config on success.
   */
  public async configureInteractive(
    projectDir: string
  ): Promise<AppConfig | undefined> {
    const existing = await this.readConfig(projectDir);
    const cur = existing.ok ? existing.config : undefined;

    const id = await vscode.window.showInputBox({
      title: "Maix App: id",
      prompt: "App id (letters, numbers, underscore; must start with letter)",
      value: cur?.id || path.basename(projectDir).replace(/[^a-zA-Z0-9_]/g, "_") || "app",
      validateInput: (v) =>
        isValidAppId(v.trim()) ? undefined : "Invalid id (e.g. my_app)",
    });
    if (id === undefined) {
      return undefined;
    }

    const name = await vscode.window.showInputBox({
      title: "Maix App: name",
      prompt: "Display name",
      value: cur?.name || path.basename(projectDir),
      validateInput: (v) => (v.trim() ? undefined : "Name is required"),
    });
    if (name === undefined) {
      return undefined;
    }

    const version = await vscode.window.showInputBox({
      title: "Maix App: version",
      prompt: "Semver version (x.y.z)",
      value: cur?.version || "1.0.0",
      validateInput: (v) =>
        isValidAppVersion(v.trim()) ? undefined : "Use x.y.z (e.g. 1.0.0)",
    });
    if (version === undefined) {
      return undefined;
    }

    const author = await vscode.window.showInputBox({
      title: "Maix App: author",
      prompt: "Author (optional)",
      value: cur?.author || "",
    });
    if (author === undefined) {
      return undefined;
    }

    const desc = await vscode.window.showInputBox({
      title: "Maix App: description",
      prompt: "Short description (single line)",
      value: cur?.desc || "",
    });
    if (desc === undefined) {
      return undefined;
    }

    let files = cur?.files?.length ? [...cur.files] : [];
    if (!files.length) {
      const all = await this.listProjectFiles(projectDir);
      const py = all.filter((f) => f.endsWith(".py"));
      const picks = await vscode.window.showQuickPick(
        all.map((f) => ({
          label: f,
          picked:
            f === "main.py" ||
            f === APP_YAML_NAME ||
            py.includes(f) ||
            f === APP_ICON_NAME,
        })),
        {
          title: "Select files to include in package",
          canPickMany: true,
          placeHolder: "main.py is required for multi-file apps",
        }
      );
      if (!picks) {
        return undefined;
      }
      files = picks.map((p) => p.label);
    }

    if (!files.includes("main.py") && files.length !== 1) {
      // Allow single non-main if only one file (renamed to main.py in zip)
      const hasMain = files.some((f) => path.basename(f) === "main.py");
      if (!hasMain && files.length !== 1) {
        vscode.window.showErrorMessage(
          "Package must include main.py (or exactly one Python file)."
        );
        return undefined;
      }
    }

    const config: AppConfig = {
      id: id.trim(),
      name: name.trim(),
      version: version.trim(),
      author: (author || "").trim(),
      desc: (desc || "").replace(/\n/g, " ").trim(),
      icon: cur?.icon || (fs.existsSync(path.join(projectDir, APP_ICON_NAME)) ? APP_ICON_NAME : ""),
      files,
    };

    const written = await this.writeConfig(projectDir, config);
    if (!written.ok) {
      vscode.window.showErrorMessage(`Failed to write app.yaml: ${written.message}`);
      return undefined;
    }
    return config;
  }

  public formatSize(bytes: number): string {
    if (bytes > 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }
    if (bytes > 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${bytes} B`;
  }

  public async readZipFile(zipPath: string): Promise<Buffer> {
    return fs.promises.readFile(zipPath);
  }
}

/** Shared size thresholds for RunProject (MB), matching MaixVision */
export const RUN_PROJECT_WARN_MB = 5;
export const RUN_PROJECT_BLOCK_MB = 30;
