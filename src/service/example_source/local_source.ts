import * as fs from "fs";
import * as path from "path";
import { ExampleSource, resolveUserPath } from "./types";
import { log } from "../../logger";
import { copyDir, emptyDir, ensureDir } from "./fs_util";

export class LocalFileExampleSource implements ExampleSource {
  readonly type = "local_folder" as const;
  private readonly configuredPath: string;
  private readonly sourcePath: string;

  constructor(
    public readonly id: string,
    public readonly label: string,
    public readonly rootDir: string,
    sourcePath: string
  ) {
    this.configuredPath = sourcePath;
    this.sourcePath = resolveUserPath(sourcePath);
  }

  async refresh(progress?: (msg: string) => void): Promise<void> {
    progress?.(`Syncing local ${this.label}...`);
    log(
      `[ExampleSource:${this.id}] refresh local_folder configured="${this.configuredPath}" resolved="${this.sourcePath}" -> ${this.rootDir}`
    );
    if (!fs.existsSync(this.sourcePath)) {
      throw new Error(
        `Local example path does not exist: ${this.sourcePath}` +
          (this.configuredPath !== this.sourcePath
            ? ` (from "${this.configuredPath}")`
            : "") +
          `. Use an absolute path, ~/..., or \${workspaceFolder}/...`
      );
    }
    const stat = fs.statSync(this.sourcePath);
    if (!stat.isDirectory() && !stat.isFile()) {
      throw new Error(`Local example path is not a file or folder: ${this.sourcePath}`);
    }
    ensureDir(this.rootDir);
    await emptyDir(this.rootDir);
    if (stat.isDirectory()) {
      await copyDir(this.sourcePath, this.rootDir);
    } else {
      const dest = path.join(this.rootDir, path.basename(this.sourcePath));
      await fs.promises.copyFile(this.sourcePath, dest);
    }
    log(`[ExampleSource:${this.id}] refresh done`);
  }
}
