/** MaixVision/MaixPy project app.yaml fields */
export type AppConfig = {
  id: string;
  version: string;
  name: string;
  author?: string;
  desc?: string;
  /** Relative path under project dir, usually "app.png" */
  icon?: string;
  /** Relative file paths included in the package */
  files: string[];
  [key: string]: unknown;
};

export type PackageInfo = {
  name: string;
  path: string;
  size: number;
};

export type AppConfigResult =
  | { ok: true; config: AppConfig | undefined }
  | { ok: false; message: string };

export type PackageInfoResult =
  | {
      ok: true;
      config: AppConfig | undefined;
      info?: PackageInfo;
    }
  | { ok: false; message: string };

export const APP_YAML_NAME = "app.yaml";
export const APP_ICON_NAME = "app.png";

/** Folders skipped when zipping a whole project for RunProject (MaixVision EXCLUDE_FOLDERS) */
export const RUN_PROJECT_EXCLUDE_FOLDERS = [
  "__pycache__",
  ".git",
  ".vscode",
  ".idea",
  ".pytype",
  ".env",
  ".venv",
  "dist",
  "node_modules",
] as const;

export function isValidAppId(id: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(id);
}

export function isValidAppVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}
