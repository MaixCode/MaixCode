import * as vscode from "vscode";
import { DeviceService } from "./device_service";
import { WebSocketService } from "./websocket_service";
import {
  ProjectPackageService,
  RUN_PROJECT_BLOCK_MB,
  RUN_PROJECT_WARN_MB,
} from "./project_package_service";
import { AppConfig, PackageInfo } from "../model/app_config";
import { error, formatUnknown, log, showLog } from "../logger";
import { DebugTypeName } from "../constants";

export type ProjectDeployDeps = {
  getConnectedDevices: () => DeviceService[];
  getCurrentDevice: () => DeviceService | undefined;
  /** File accessor for runtime (shared with debugger) */
  fileAccessor: {
    isWindows: boolean;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, contents: Uint8Array): Promise<void>;
  };
};

/**
 * Orchestrates package / install / run-project UX (commands).
 */
export class ProjectDeployService {
  private readonly packages = new ProjectPackageService();
  private installing = false;

  constructor(private readonly deps: ProjectDeployDeps) {}

  public get packageService(): ProjectPackageService {
    return this.packages;
  }

  private pickDevice(): DeviceService | undefined {
    const connected = this.deps.getConnectedDevices();
    if (connected.length === 0) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("No device connected. Connect a MaixCAM from the MaixCode sidebar first.")
      );
      return undefined;
    }
    const preferred = this.deps.getCurrentDevice();
    if (preferred && connected.includes(preferred)) {
      return preferred;
    }
    return connected[0];
  }

  private requireProjectDir(hint?: string): string | undefined {
    const dir = this.packages.resolveProjectDir(hint);
    if (!dir) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("No project folder found. Open a workspace folder or a file under the project.")
      );
      return undefined;
    }
    return dir;
  }

  public async configureProject(hint?: string): Promise<void> {
    const dir = this.requireProjectDir(hint);
    if (!dir) {
      return;
    }
    const config = await this.packages.configureInteractive(dir);
    if (!config) {
      return;
    }
    vscode.window.showInformationMessage(
      vscode.l10n.t("Saved app.yaml for {0} ({1} v{2}) in {3}", config.name, config.id, config.version, dir)
    );
  }

  public async packageProject(hint?: string): Promise<PackageInfo | undefined> {
    const dir = this.requireProjectDir(hint);
    if (!dir) {
      return undefined;
    }

    let infoResult = await this.packages.getPackageInfo(dir);
    if (!infoResult.ok) {
      vscode.window.showErrorMessage(infoResult.message);
      return undefined;
    }

    if (!infoResult.config) {
      const configure = vscode.l10n.t("Configure");
      const go = await vscode.window.showInformationMessage(
        vscode.l10n.t("No app.yaml found. Configure the project now?"),
        configure,
        vscode.l10n.t("Cancel")
      );
      if (go !== configure) {
        return undefined;
      }
      const config = await this.packages.configureInteractive(dir);
      if (!config) {
        return undefined;
      }
    } else if (!infoResult.config.files?.length) {
      const configure = vscode.l10n.t("Configure");
      const go = await vscode.window.showInformationMessage(
        vscode.l10n.t("app.yaml has no files list. Reconfigure?"),
        configure,
        vscode.l10n.t("Cancel")
      );
      if (go !== configure) {
        return undefined;
      }
      const config = await this.packages.configureInteractive(dir);
      if (!config) {
        return undefined;
      }
    }

    // Keep dialogs outside withProgress so the toast can dismiss immediately.
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("MaixCode: Packaging app..."),
        cancellable: false,
      },
      async () => this.packages.packageApp(dir)
    );
    if (!result.ok) {
      vscode.window.showErrorMessage(vscode.l10n.t("Package failed: {0}", result.message));
      return undefined;
    }
    const reveal = vscode.l10n.t("Reveal in Explorer");
    const installTo = vscode.l10n.t("Install to Device");
    const open = await vscode.window.showInformationMessage(
      vscode.l10n.t("Packaged {0} ({1})", result.info.name, this.packages.formatSize(result.info.size)),
      reveal,
      installTo
    );
    if (open === reveal) {
      await vscode.commands.executeCommand(
        "revealFileInOS",
        vscode.Uri.file(result.info.path)
      );
    } else if (open === installTo) {
      await this.installPackagePath(result.info.path, result.config);
    }
    return result.info;
  }

  public async installToDevice(hint?: string): Promise<void> {
    const dir = this.requireProjectDir(hint);
    if (!dir) {
      return;
    }
    const device = this.pickDevice();
    if (!device) {
      return;
    }

    let pkg = await this.packages.getPackageInfo(dir);
    if (!pkg.ok) {
      vscode.window.showErrorMessage(pkg.message);
      return;
    }
    if (!pkg.info) {
      const packageLabel = vscode.l10n.t("Package");
      const go = await vscode.window.showInformationMessage(
        vscode.l10n.t("No package zip found under dist/. Package now?"),
        packageLabel,
        vscode.l10n.t("Cancel")
      );
      if (go !== packageLabel) {
        return;
      }
      const built = await this.packages.packageApp(dir);
      if (!built.ok) {
        vscode.window.showErrorMessage(vscode.l10n.t("Package failed: {0}", built.message));
        return;
      }
      pkg = { ok: true, config: built.config, info: built.info };
    }

    if (!pkg.ok || !pkg.info) {
      return;
    }
    await this.installPackagePath(pkg.info.path, pkg.config);
  }

  public async installPackagePath(
    zipPath: string,
    config?: AppConfig
  ): Promise<void> {
    if (this.installing) {
      vscode.window.showWarningMessage(vscode.l10n.t("An install is already in progress."));
      return;
    }
    const device = this.pickDevice();
    if (!device?.wss?.isConnected) {
      vscode.window.showErrorMessage(vscode.l10n.t("Device is not connected."));
      return;
    }
    const wss = device.wss;
    if (typeof wss.installApp !== "function") {
      vscode.window.showErrorMessage(vscode.l10n.t("Transport does not support installApp."));
      return;
    }

    let zipData: Buffer;
    try {
      zipData = await this.packages.readZipFile(zipPath);
    } catch (e) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Cannot read package: {0}", formatUnknown(e))
      );
      return;
    }

    this.installing = true;
    showLog();
    log(
      `[ProjectDeploy] install ${zipPath} (${zipData.length} bytes) -> ${device.device?.ip}`
    );

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: config
            ? vscode.l10n.t("Installing {0} v{1}...", config.name, config.version)
            : vscode.l10n.t("Installing app to device..."),
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: "0%" });
          await this.sendInstallAndWait(wss, zipData, (pct) => {
            progress.report({ message: `${pct}%` });
          });
        }
      );
      vscode.window.showInformationMessage(vscode.l10n.t("App installed on device."));
    } catch (e) {
      error(`[ProjectDeploy] install failed: ${formatUnknown(e)}`, true);
    } finally {
      this.installing = false;
    }
  }

  private sendInstallAndWait(
    wss: WebSocketService,
    zipData: Buffer,
    onProgress: (pct: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Install timed out (no InstallAppAck within 120s)"));
      }, 120_000);

      const onInstall = (rsp: {
        code?: number;
        progress?: number;
        msg?: string;
      }) => {
        if (done) {
          return;
        }
        if (rsp.code !== 0) {
          cleanup();
          reject(new Error(rsp.msg || "Install failed"));
          return;
        }
        const pct = typeof rsp.progress === "number" ? rsp.progress : 0;
        onProgress(pct);
        log(`[ProjectDeploy] install progress ${pct}%`);
        if (pct >= 100) {
          cleanup();
          resolve();
        }
      };
      const onError = (err: unknown) => {
        if (done) {
          return;
        }
        cleanup();
        reject(new Error(formatUnknown(err)));
      };
      const onClose = () => {
        if (done) {
          return;
        }
        cleanup();
        reject(new Error("Device disconnected during install"));
      };

      const cleanup = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        wss.off("installApp", onInstall);
        wss.off("error", onError);
        wss.off("close", onClose);
      };

      wss.on("installApp", onInstall);
      wss.on("error", onError);
      wss.on("close", onClose);
      wss.installApp(zipData);
    });
  }

  /**
   * Zip workspace project (exclude dist/.git/...) and run via RunProject.
   * Uses MaixPyRuntime so Debug Console gets output and Stop works.
   */
  public async runProject(hint?: string): Promise<void> {
    const dir = this.requireProjectDir(hint);
    if (!dir) {
      return;
    }
    const device = this.pickDevice();
    if (!device) {
      return;
    }

    const hasMain = await this.packages.ensureMainPy(dir);
    if (!hasMain) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("main.py not found in {0}. Run Project requires a main.py entry.", dir)
      );
      return;
    }

    // Save dirty editors under project
    for (const doc of vscode.workspace.textDocuments) {
      if (
        doc.isDirty &&
        doc.uri.scheme === "file" &&
        doc.uri.fsPath.startsWith(dir)
      ) {
        await doc.save();
      }
    }

    showLog();
    const packed = await this.packages.packageFolderForRun(dir);
    if (!packed.ok) {
      vscode.window.showErrorMessage(vscode.l10n.t("Run Project failed: {0}", packed.message));
      return;
    }

    const sizeMb = packed.info.size / 1024 / 1024;
    if (sizeMb > RUN_PROJECT_BLOCK_MB) {
      vscode.window.showErrorMessage(
        vscode.l10n.t(
          "Project zip is {0} MB (limit {1} MB). Reduce size or exclude assets.",
          sizeMb.toFixed(1),
          String(RUN_PROJECT_BLOCK_MB)
        )
      );
      return;
    }
    if (sizeMb > RUN_PROJECT_WARN_MB) {
      const continueLabel = vscode.l10n.t("Continue");
      const cont = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          "Project zip is {0} MB (over {1} MB). Continue?",
          sizeMb.toFixed(1),
          String(RUN_PROJECT_WARN_MB)
        ),
        continueLabel,
        vscode.l10n.t("Cancel")
      );
      if (cont !== continueLabel) {
        return;
      }
    }

    log(
      `[ProjectDeploy] runProject ${packed.info.path} (${packed.info.size} bytes) -> ${device.device?.ip}`
    );

    // Launch via debug adapter so Debug Console + Stop toolbar work.
    try {
      const started = await vscode.debug.startDebugging(undefined, {
        type: DebugTypeName,
        request: "launch",
        name: vscode.l10n.t("MaixPy: Run Project on Device"),
        program: dir,
        mode: "project",
        projectDir: dir,
        projectZip: packed.info.path,
        noDebug: true,
      });
      log(`[ProjectDeploy] startDebugging project returned ${started}`);
      if (!started) {
        vscode.window.showErrorMessage(
          vscode.l10n.t("Failed to start MaixPy debug session for Run Project.")
        );
      }
    } catch (e) {
      error(`[ProjectDeploy] runProject debug failed: ${formatUnknown(e)}`, true);
    }
  }

  public async packageAndInstall(hint?: string): Promise<void> {
    const dir = this.requireProjectDir(hint);
    if (!dir) {
      return;
    }
    const read = await this.packages.readConfig(dir);
    let config = read.ok ? read.config : undefined;
    if (!config) {
      config = await this.packages.configureInteractive(dir);
      if (!config) {
        return;
      }
    }
    const built = await this.packages.packageApp(dir);
    if (!built.ok) {
      vscode.window.showErrorMessage(vscode.l10n.t("Package failed: {0}", built.message));
      return;
    }
    await this.installPackagePath(built.info.path, built.config);
  }
}
