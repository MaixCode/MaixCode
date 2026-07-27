import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { log, warn } from "../logger";
import { DevicePlugin, PluginManifest, PluginPermission } from "./types";

declare const __non_webpack_require__: NodeJS.Require | undefined;

const ManifestFileName = "maixplugin.json";
const SupportedApiVersion = "1.0";
const ValidPermissions = new Set<PluginPermission>([
  "device.info",
  "device.connection",
  "device.frame",
  "device.imageFormat",
  "device.run",
  "device.stop",
  "device.ws",
  "device.runtime",
  "ssh.shell",
  "ssh.sftp",
  "ui.sidebar",
  "ui.panel",
  "ui.command",
  "config.read",
  "config.write",
]);

export interface LoadedLocalPlugin {
  readonly plugin: DevicePlugin;
  readonly manifest: PluginManifest;
  readonly directoryPath: string;
  readonly manifestPath: string;
  readonly entryPath: string;
}

function getNodeRequire(): NodeJS.Require {
  if (typeof __non_webpack_require__ === "function") {
    return __non_webpack_require__;
  }
  return eval("require") as NodeJS.Require;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid plugin manifest field: ${field}`);
  }
  return value;
}

function normalizeManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) {
    throw new Error("Invalid plugin manifest: expected an object");
  }
  const id = asString(raw.id, "id");
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid plugin id: ${id}`);
  }
  const permissions = raw.permissions;
  if (!Array.isArray(permissions) || permissions.some((permission) => !ValidPermissions.has(permission as PluginPermission))) {
    throw new Error("Invalid plugin permissions");
  }
  const apiVersion = asString(raw.apiVersion, "apiVersion");
  if (apiVersion !== SupportedApiVersion) {
    throw new Error(`Unsupported plugin API version: ${apiVersion}`);
  }
  return {
    id,
    name: asString(raw.name, "name"),
    version: asString(raw.version, "version"),
    main: asString(raw.main, "main"),
    apiVersion,
    permissions: permissions as PluginPermission[],
    contributes: isRecord(raw.contributes)
      ? {
          commands: Array.isArray(raw.contributes.commands)
            ? raw.contributes.commands
                .filter(isRecord)
                .map((command) => ({
                  id: asString(command.id, "contributes.commands[].id"),
                  title: asString(command.title, "contributes.commands[].title"),
                }))
            : undefined,
          views: Array.isArray(raw.contributes.views)
            ? raw.contributes.views
                .filter(isRecord)
                .map((view) => ({
                  id: asString(view.id, "contributes.views[].id"),
                  name: asString(view.name, "contributes.views[].name"),
                }))
            : undefined,
        }
      : undefined,
  };
}

export class PluginLoader {
  public async readManifest(directoryPath: string): Promise<{ manifest: PluginManifest; manifestPath: string }> {
    const manifestPath = path.join(directoryPath, ManifestFileName);
    const raw = await fsp.readFile(manifestPath, "utf8");
    return {
      manifest: normalizeManifest(JSON.parse(raw) as unknown),
      manifestPath,
    };
  }

  public async loadFromDirectory(directoryPath: string): Promise<LoadedLocalPlugin> {
    const { manifest, manifestPath } = await this.readManifest(directoryPath);
    const entryPath = path.resolve(directoryPath, manifest.main);
    const normalizedDirectory = path.resolve(directoryPath);
    if (entryPath !== normalizedDirectory && !entryPath.startsWith(`${normalizedDirectory}${path.sep}`)) {
      throw new Error(`Plugin entry must stay inside the plugin folder: ${manifest.main}`);
    }
    const entryStat = await fsp.stat(entryPath).catch(() => undefined);
    if (!entryStat?.isFile()) {
      throw new Error(`Plugin entry not found: ${manifest.main}`);
    }
    log(`[PluginLoader] load ${manifest.id} from ${directoryPath}`);
    const required = getNodeRequire()(entryPath) as { default?: unknown } | unknown;
    const plugin = ((required as { default?: unknown })?.default ?? required) as DevicePlugin;
    if (!plugin || typeof plugin.activate !== "function" || !plugin.manifest) {
      throw new Error("Plugin module must export a DevicePlugin object");
    }
    if (plugin.manifest.id !== manifest.id) {
      throw new Error(`Plugin manifest id mismatch: ${plugin.manifest.id} !== ${manifest.id}`);
    }
    if (plugin.manifest.apiVersion !== manifest.apiVersion) {
      throw new Error(`Plugin API version mismatch: ${plugin.manifest.apiVersion} !== ${manifest.apiVersion}`);
    }
    log(`[PluginLoader] loaded ${manifest.id} entry=${entryPath}`);
    return {
      plugin,
      manifest,
      directoryPath: normalizedDirectory,
      manifestPath,
      entryPath,
    };
  }

  public clearCache(directoryPath: string): void {
    const normalizedDirectory = path.resolve(directoryPath);
    const nodeRequire = getNodeRequire();
    for (const key of Object.keys(nodeRequire.cache)) {
      if (!key.startsWith(normalizedDirectory)) {
        continue;
      }
      try {
        const resolved = fs.realpathSync.native?.(key) ?? path.resolve(key);
        if (resolved === normalizedDirectory || resolved.startsWith(`${normalizedDirectory}${path.sep}`)) {
          delete nodeRequire.cache[key];
        }
      } catch (error) {
        warn(`[PluginLoader] skip cache entry ${key}: ${error instanceof Error ? error.message : String(error)}`);
        if (key.startsWith(normalizedDirectory)) {
          delete nodeRequire.cache[key];
        }
      }
    }
  }
}
