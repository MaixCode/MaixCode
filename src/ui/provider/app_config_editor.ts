import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import sharp from "sharp";
import {
  APP_ICON_NAME,
  APP_YAML_NAME,
  AppConfig,
  isValidAppId,
  isValidAppVersion,
} from "../../model/app_config";
import { ProjectPackageService } from "../../service/project_package_service";
import { error, formatUnknown, log } from "../../logger";

export type AppConfigEditorDeps = {
  packageService: ProjectPackageService;
};

type EditorConfigPayload = {
  id: string;
  name: string;
  version: string;
  author: string;
  desc: string;
  icon: string;
  files: string[];
};

type IncomingMessage = {
  type?: string;
  config?: Partial<EditorConfigPayload>;
  silent?: boolean;
};

type ValidatedConfig =
  | { ok: true; config: AppConfig }
  | { ok: false; message: string };

/** Default square size written for app icon (cover crop). */
const ICON_SIZE = 256;

/**
 * Visual app.yaml editor (WebviewPanel).
 * No Instance import; uses ProjectPackageService via deps.
 */
export class AppConfigEditor {
  public static readonly viewType = "maixcodeAppConfig";

  private panel: vscode.WebviewPanel | undefined;
  private projectDir: string | undefined;
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private reloadTimer: NodeJS.Timeout | undefined;
  /** Ignore next watcher event(s) after our own write */
  private ignoreWatcherUntil = 0;
  private lastWrittenJson = "";
  private saving = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: AppConfigEditorDeps
  ) {
    context.subscriptions.push({
      dispose: () => this.dispose(),
    });
  }

  public dispose(): void {
    this.clearWatcher();
    this.panel?.dispose();
    this.panel = undefined;
  }

  /**
   * Open (or reveal) the visual app.yaml editor for a project directory.
   * @returns projectDir when opened, else undefined
   */
  public async show(hint?: string): Promise<string | undefined> {
    const dir = this.deps.packageService.resolveProjectDir(hint);
    if (!dir) {
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "No project folder found. Open a workspace folder or a file under the project."
        )
      );
      return undefined;
    }

    this.projectDir = dir;

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        AppConfigEditor.viewType,
        vscode.l10n.t("Maix App Config"),
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(
              this.context.extensionUri,
              "media",
              "app_config_editor"
            ),
          ],
        }
      );

      this.panel.onDidDispose(() => {
        this.clearWatcher();
        this.panel = undefined;
        this.projectDir = undefined;
        this.lastWrittenJson = "";
      });

      this.panel.webview.onDidReceiveMessage((message) => {
        void this.onMessage(message as IncomingMessage);
      });

      this.panel.webview.html = this.getHtml(this.panel.webview);
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.html = this.getHtml(this.panel.webview);
    }

    this.panel.title = vscode.l10n.t("Maix App Config · {0}", path.basename(dir));
    this.setupWatcher(dir);
    await this.pushState();
    return dir;
  }

  private clearWatcher(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    this.fileWatcher?.dispose();
    this.fileWatcher = undefined;
  }

  private setupWatcher(projectDir: string): void {
    this.clearWatcher();
    // Watch app.yaml (and common typo app.yml) for external edits
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(projectDir, "app.y*ml")
    );
    const schedule = () => {
      if (Date.now() < this.ignoreWatcherUntil || this.saving) {
        return;
      }
      if (this.reloadTimer) {
        clearTimeout(this.reloadTimer);
      }
      this.reloadTimer = setTimeout(() => {
        void this.pushState({ fromDisk: true });
      }, 250);
    };
    this.fileWatcher.onDidChange(schedule);
    this.fileWatcher.onDidCreate(schedule);
    this.fileWatcher.onDidDelete(schedule);
  }

  private defaultConfig(projectDir: string, cur?: AppConfig): EditorConfigPayload {
    const baseName = path.basename(projectDir);
    const idGuess =
      cur?.id ||
      baseName.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]+/, "") ||
      "app";
    const hasIcon = fs.existsSync(path.join(projectDir, APP_ICON_NAME));
    return {
      id: idGuess,
      name: cur?.name || baseName,
      version: cur?.version || "1.0.0",
      author: cur?.author || "",
      desc: cur?.desc || "",
      icon: cur?.icon || (hasIcon ? APP_ICON_NAME : ""),
      files: cur?.files?.length ? [...cur.files] : [],
    };
  }

  private async iconPreviewDataUrl(
    projectDir: string,
    iconRel: string
  ): Promise<string | undefined> {
    if (!iconRel || iconRel.startsWith("data:")) {
      return undefined;
    }
    const abs = path.join(projectDir, iconRel);
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return undefined;
      }
      // Always present a 1:1 preview (cover crop), independent of source aspect
      const buf = await sharp(abs)
        .resize(ICON_SIZE, ICON_SIZE, {
          fit: "cover",
          position: "centre",
        })
        .png()
        .toBuffer();
      return `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      try {
        const raw = await fs.promises.readFile(abs);
        const ext = path.extname(abs).toLowerCase();
        const mime =
          ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : "application/octet-stream";
        return `data:${mime};base64,${raw.toString("base64")}`;
      } catch {
        return undefined;
      }
    }
  }

  /**
   * Write icon as square PNG (cover crop) under project as app.png.
   */
  private async writeSquareIcon(
    projectDir: string,
    sourceAbs: string
  ): Promise<{ ok: true; rel: string } | { ok: false; message: string }> {
    const dest = path.join(projectDir, APP_ICON_NAME);
    try {
      await sharp(sourceAbs)
        .resize(ICON_SIZE, ICON_SIZE, {
          fit: "cover",
          position: "centre",
        })
        .png()
        .toFile(dest);
      log(`[AppConfigEditor] wrote 1:1 icon ${dest}`);
      return { ok: true, rel: APP_ICON_NAME };
    } catch (e) {
      // Fallback: plain copy if sharp fails
      try {
        await fs.promises.copyFile(sourceAbs, dest);
        log(`[AppConfigEditor] sharp failed, copied icon to ${dest}: ${formatUnknown(e)}`);
        return { ok: true, rel: APP_ICON_NAME };
      } catch (e2) {
        return { ok: false, message: formatUnknown(e2) };
      }
    }
  }

  private async pushState(opts?: { fromDisk?: boolean }): Promise<void> {
    if (!this.panel || !this.projectDir) {
      return;
    }
    const projectDir = this.projectDir;
    try {
      const read = await this.deps.packageService.readConfig(projectDir);
      if (!read.ok) {
        void this.panel.webview.postMessage({
          type: "error",
          message: read.message,
        });
        return;
      }
      const config = this.defaultConfig(projectDir, read.config);
      let projectFiles = await this.deps.packageService.listProjectFiles(projectDir);
      for (const f of config.files) {
        if (!projectFiles.includes(f)) {
          projectFiles.push(f);
        }
      }
      projectFiles = [...new Set(projectFiles)].sort((a, b) => a.localeCompare(b));

      if (!config.files.length) {
        const suggested = projectFiles.filter(
          (f) =>
            f === "main.py" ||
            f === APP_YAML_NAME ||
            f === APP_ICON_NAME ||
            f.endsWith(".py")
        );
        config.files = suggested.length ? suggested : projectFiles.slice(0, 1);
      }

      const iconPreview = await this.iconPreviewDataUrl(projectDir, config.icon);
      const yamlExists = fs.existsSync(path.join(projectDir, APP_YAML_NAME));
      this.lastWrittenJson = JSON.stringify(config);

      void this.panel.webview.postMessage({
        type: "init",
        projectDir,
        projectName: path.basename(projectDir),
        yamlExists,
        config,
        projectFiles,
        iconPreview,
        fromDisk: !!opts?.fromDisk,
        autoSave: true,
      });
    } catch (e) {
      error(`[AppConfigEditor] pushState: ${formatUnknown(e)}`);
      void this.panel.webview.postMessage({
        type: "error",
        message: formatUnknown(e),
      });
    }
  }

  private async onMessage(message: IncomingMessage): Promise<void> {
    if (!message?.type || !this.panel) {
      return;
    }
    switch (message.type) {
      case "ready":
        await this.pushState();
        break;
      case "reload":
        await this.pushState({ fromDisk: true });
        break;
      case "save":
        await this.handleSave(message.config, { silent: !!message.silent });
        break;
      case "browseIcon":
        await this.handleBrowseIcon();
        break;
      case "openYaml":
        await this.handleOpenYaml();
        break;
      case "selectAllPy":
        await this.handleSelectPattern((f) => f.endsWith(".py"));
        break;
      case "clearFiles":
        void this.panel.webview.postMessage({
          type: "setFiles",
          files: [],
        });
        break;
      default:
        break;
    }
  }

  private async handleSelectPattern(
    pred: (rel: string) => boolean
  ): Promise<void> {
    if (!this.panel || !this.projectDir) {
      return;
    }
    const files = await this.deps.packageService.listProjectFiles(this.projectDir);
    void this.panel.webview.postMessage({
      type: "setFiles",
      files: files.filter(pred),
    });
  }

  private async handleOpenYaml(): Promise<void> {
    if (!this.projectDir) {
      return;
    }
    const p = path.join(this.projectDir, APP_YAML_NAME);
    if (!fs.existsSync(p)) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("app.yaml does not exist yet. Save the form first.")
      );
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
  }

  private async handleBrowseIcon(): Promise<void> {
    if (!this.panel || !this.projectDir) {
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(this.projectDir),
      filters: {
        [vscode.l10n.t("Images")]: ["png", "jpg", "jpeg", "gif", "webp"],
      },
      openLabel: vscode.l10n.t("Select Icon"),
    });
    if (!picked?.[0]) {
      return;
    }
    const abs = picked[0].fsPath;
    const written = await this.writeSquareIcon(this.projectDir, abs);
    if (!written.ok) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Failed to copy icon: {0}", written.message)
      );
      return;
    }
    const iconPreview = await this.iconPreviewDataUrl(
      this.projectDir,
      written.rel
    );
    void this.panel.webview.postMessage({
      type: "iconPicked",
      icon: written.rel,
      iconPreview,
    });
  }

  private validate(raw?: Partial<EditorConfigPayload>): ValidatedConfig {
    if (!raw) {
      return { ok: false, message: vscode.l10n.t("Name is required") };
    }
    const id = String(raw.id || "").trim();
    const name = String(raw.name || "").trim();
    const version = String(raw.version || "").trim();
    const author = String(raw.author || "").trim();
    const desc = String(raw.desc || "").replace(/\n/g, " ").trim();
    const icon = String(raw.icon || "").trim();
    const files = Array.isArray(raw.files)
      ? raw.files.map((f) => String(f).replace(/\\/g, "/")).filter(Boolean)
      : [];

    if (!isValidAppId(id)) {
      return { ok: false, message: vscode.l10n.t("Invalid id (e.g. my_app)") };
    }
    if (!name) {
      return { ok: false, message: vscode.l10n.t("Name is required") };
    }
    if (!isValidAppVersion(version)) {
      return { ok: false, message: vscode.l10n.t("Use x.y.z (e.g. 1.0.0)") };
    }
    if (!files.length) {
      return {
        ok: false,
        message: vscode.l10n.t("app.yaml has no files list. Add files to package."),
      };
    }
    if (files.length !== 1) {
      const hasMain = files.some((f) => path.basename(f) === "main.py");
      if (!hasMain) {
        return {
          ok: false,
          message: vscode.l10n.t(
            "Package must include main.py (or exactly one Python file)."
          ),
        };
      }
    }

    return {
      ok: true,
      config: { id, name, version, author, desc, icon, files },
    };
  }

  private async handleSave(
    raw?: Partial<EditorConfigPayload>,
    opts?: { silent?: boolean }
  ): Promise<void> {
    if (!this.panel || !this.projectDir) {
      return;
    }
    const silent = !!opts?.silent;
    const validated = this.validate(raw);
    if (!validated.ok) {
      void this.panel.webview.postMessage({
        type: "saveResult",
        ok: false,
        silent,
        message: validated.message,
      });
      return;
    }
    const config = validated.config;
    const nextJson = JSON.stringify({
      id: config.id,
      name: config.name,
      version: config.version,
      author: config.author || "",
      desc: config.desc || "",
      icon: config.icon || "",
      files: config.files,
    });
    if (nextJson === this.lastWrittenJson) {
      void this.panel.webview.postMessage({
        type: "saveResult",
        ok: true,
        silent: true,
        skipped: true,
        config: JSON.parse(nextJson) as EditorConfigPayload,
      });
      return;
    }

    this.saving = true;
    this.ignoreWatcherUntil = Date.now() + 800;
    const written = await this.deps.packageService.writeConfig(
      this.projectDir,
      config
    );
    this.saving = false;

    if (!written.ok) {
      void this.panel.webview.postMessage({
        type: "saveResult",
        ok: false,
        silent,
        message: vscode.l10n.t("Failed to write app.yaml: {0}", written.message),
      });
      return;
    }

    this.lastWrittenJson = nextJson;
    const payload: EditorConfigPayload = {
      id: config.id,
      name: config.name,
      version: config.version,
      author: config.author || "",
      desc: config.desc || "",
      icon: config.icon || "",
      files: config.files,
    };

    void this.panel.webview.postMessage({
      type: "saveResult",
      ok: true,
      silent,
      message: silent
        ? vscode.l10n.t("Auto-saved app.yaml")
        : vscode.l10n.t(
            "Saved app.yaml for {0} ({1} v{2}) in {3}",
            config.name,
            config.id,
            config.version,
            this.projectDir
          ),
      config: payload,
    });

    if (!silent) {
      vscode.window.showInformationMessage(
        vscode.l10n.t(
          "Saved app.yaml for {0} ({1} v{2}) in {3}",
          config.name,
          config.id,
          config.version,
          this.projectDir
        )
      );
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "app_config_editor",
        "main.css"
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "app_config_editor",
        "main.js"
      )
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: blob:`,
      "font-src data:",
    ].join("; ");

    const t = (s: string) => this.escapeHtml(vscode.l10n.t(s));
    const tTitle = t("Maix App Config");
    const tProject = t("Project");
    const tId = t("App id");
    const tName = t("Display name");
    const tVersion = t("Version");
    const tAuthor = t("Author");
    const tDesc = t("Description");
    const tIcon = t("Icon");
    const tBrowse = t("Browse…");
    const tFiles = t("Package files");
    const tFilter = t("Filter files");
    const tSelectPy = t("Select all .py");
    const tClear = t("Clear");
    const tSave = t("Save app.yaml");
    const tReload = t("Reload");
    const tOpenYaml = t("Open app.yaml");
    const tHintId = t("Letters, numbers, underscore; must start with a letter");
    const tHintVer = t("Semver x.y.z (e.g. 1.0.0)");
    const tHintFiles = t(
      "Multi-file packages need main.py. A single file is stored as main.py in the zip."
    );
    const tHintIcon = t("Icons are saved as 1:1 PNG (cover crop → app.png).");
    const tLoading = t("Loading…");
    const tSelected = t("selected");
    const tNoIcon = t("No icon");
    const tAutoSave = t("Auto-save");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${tTitle}</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <header class="topbar">
    <div class="topbar-title">
      <span class="brand">${tTitle}</span>
      <span class="project-path" id="projectLabel">${tLoading}</span>
    </div>
    <div class="topbar-actions">
      <span class="autosave-badge" id="autoSaveBadge" title="${tAutoSave}">${tAutoSave}</span>
      <button type="button" class="btn" id="reloadBtn">${tReload}</button>
      <button type="button" class="btn" id="openYamlBtn">${tOpenYaml}</button>
      <button type="button" class="btn primary" id="saveBtn">${tSave}</button>
    </div>
  </header>
  <div class="status" id="statusBar" hidden></div>
  <main class="layout">
    <section class="card form-card" aria-label="${tProject}">
      <h2>${tProject}</h2>
      <div class="field">
        <label class="label" for="fieldId">${tId}</label>
        <input type="text" id="fieldId" spellcheck="false" autocomplete="off" />
        <span class="hint">${tHintId}</span>
      </div>
      <div class="field">
        <label class="label" for="fieldName">${tName}</label>
        <input type="text" id="fieldName" autocomplete="off" />
      </div>
      <div class="field">
        <label class="label" for="fieldVersion">${tVersion}</label>
        <input type="text" id="fieldVersion" spellcheck="false" autocomplete="off" placeholder="1.0.0" />
        <span class="hint">${tHintVer}</span>
      </div>
      <div class="field">
        <label class="label" for="fieldAuthor">${tAuthor}</label>
        <input type="text" id="fieldAuthor" autocomplete="off" />
      </div>
      <div class="field">
        <label class="label" for="fieldDesc">${tDesc}</label>
        <textarea id="fieldDesc" rows="3"></textarea>
      </div>
      <div class="field icon-field">
        <label class="label" for="fieldIcon">${tIcon}</label>
        <div class="icon-row">
          <div class="icon-preview" id="iconPreview" title="${tNoIcon}">
            <span class="icon-placeholder" id="iconPlaceholder">${tNoIcon}</span>
            <img id="iconImg" alt="" hidden />
          </div>
          <div class="icon-controls">
            <input type="text" id="fieldIcon" spellcheck="false" placeholder="app.png" />
            <button type="button" class="btn" id="browseIconBtn">${tBrowse}</button>
            <span class="hint">${tHintIcon}</span>
          </div>
        </div>
      </div>
    </section>
    <section class="card files-card" aria-label="${tFiles}">
      <div class="files-head">
        <h2>${tFiles}</h2>
        <span class="files-count" id="filesCount">0 ${tSelected}</span>
      </div>
      <p class="hint files-hint">${tHintFiles}</p>
      <div class="files-toolbar">
        <input type="search" id="fileFilter" placeholder="${tFilter}" aria-label="${tFilter}" />
        <button type="button" class="btn" id="selectPyBtn">${tSelectPy}</button>
        <button type="button" class="btn" id="clearFilesBtn">${tClear}</button>
      </div>
      <div class="file-list" id="fileList" role="list"></div>
    </section>
  </main>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
