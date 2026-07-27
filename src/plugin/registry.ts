import * as vscode from "vscode";
import { PluginLoader, LoadedLocalPlugin } from "./loader";
import { PluginStorage } from "./storage";
import { DevicePlugin, DevicePluginHost, PluginManifest } from "./types";
import { DevicePluginHostAdapter } from "./host";
import { debug, log, warn } from "../logger";

export type PluginSourceKind = "builtin" | "local";
export type PluginRuntimeState = "inactive" | "active" | "disabled" | "error";

export interface PluginRecord {
  readonly id: string;
  readonly source: PluginSourceKind;
  readonly manifest: PluginManifest;
  readonly plugin: DevicePlugin;
  readonly directoryPath?: string;
  readonly entryPath?: string;
  readonly manifestPath?: string;
  readonly builtin: boolean;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly state: PluginRuntimeState;
  readonly lastError?: string;
}

type PluginEntry = {
  source: PluginSourceKind;
  plugin: DevicePlugin;
  manifest: PluginManifest;
  directoryPath?: string;
  entryPath?: string;
  manifestPath?: string;
  lastError?: string;
};

export class PluginRegistry implements vscode.Disposable {
  private readonly plugins = new Map<string, PluginEntry>();
  private readonly active = new Set<string>();
  private readonly builtins = new Set<string>();
  private readonly onDidChangePluginsEmitter = new vscode.EventEmitter<void>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: DevicePluginHost,
    private readonly loader: PluginLoader,
    private readonly storage: PluginStorage
  ) {}

  public onDidChangePlugins(listener: () => void): vscode.Disposable {
    return this.onDidChangePluginsEmitter.event(listener);
  }

  public registerBuiltin(plugin: DevicePlugin): void {
    log(`[PluginRegistry] register builtin ${plugin.manifest.id}`);
    this.register({
      source: "builtin",
      plugin,
      manifest: plugin.manifest,
    });
    this.builtins.add(plugin.manifest.id);
  }

  public list(): PluginRecord[] {
    const disabledIds = this.storage.getDisabledPluginIds();
    return Array.from(this.plugins.values())
      .map((entry) => this.toRecord(entry, disabledIds))
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name) || left.id.localeCompare(right.id));
  }

  public async activateAll(): Promise<void> {
    for (const plugin of this.list()) {
      if (plugin.enabled && plugin.state !== "error") {
        try {
          await this.activate(plugin.id);
        } catch {
          // Keep activating other plugins; the failed plugin stays in error state.
        }
      }
    }
  }

  public async activate(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin not found: ${id}`);
    }
    if (this.storage.getDisabledPluginIds().has(id)) {
      debug(`[PluginRegistry] skip disabled plugin ${id}`);
      return;
    }
    if (this.active.has(id)) {
      debug(`[PluginRegistry] already active ${id}`);
      return;
    }
    try {
      log(`[PluginRegistry] activate ${id}`);
      const scopedHost = this.scopeHost(entry.manifest.id);
      await entry.plugin.activate(scopedHost);
      entry.lastError = undefined;
      this.active.add(id);
    } catch (error) {
      entry.lastError = formatUnknown(error);
      warn(`[PluginRegistry] activate failed ${id}: ${entry.lastError}`);
      throw error;
    } finally {
      this.onDidChangePluginsEmitter.fire();
    }
  }

  private scopeHost(pluginId: string): DevicePluginHost {
    const adapter = this.host as DevicePluginHostAdapter;
    const scoped = Object.create(adapter);
    scoped.log = (message: string) => {
      adapter.log(message, pluginId);
    };
    return scoped;
  }

  public async deactivate(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry || !this.active.has(id)) {
      return;
    }
    try {
      log(`[PluginRegistry] deactivate ${id}`);
      await entry.plugin.deactivate?.();
    } finally {
      this.active.delete(id);
      this.onDidChangePluginsEmitter.fire();
    }
  }

  public async setEnabled(id: string, enabled: boolean): Promise<void> {
    log(`[PluginRegistry] setEnabled ${id}=${enabled}`);
    await this.storage.setPluginEnabled(id, enabled);
    if (enabled) {
      await this.activate(id);
    } else {
      await this.deactivate(id);
    }
    this.onDidChangePluginsEmitter.fire();
  }

  public async reload(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin not found: ${id}`);
    }
    if (entry.source === "builtin") {
      log(`[PluginRegistry] reload builtin ${id}`);
      await this.deactivate(id);
      await this.activate(id);
      return;
    }
    if (!entry.directoryPath) {
      throw new Error(`Plugin directory not found: ${id}`);
    }
    const shouldActivate = !this.storage.getDisabledPluginIds().has(id);
    log(`[PluginRegistry] reload local ${id} from ${entry.directoryPath}`);
    await this.deactivate(id);
    this.loader.clearCache(entry.directoryPath);
    const loaded = await this.loader.loadFromDirectory(entry.directoryPath);
    this.registerLoadedLocalPlugin(loaded);
    if (shouldActivate) {
      await this.activate(id);
    }
    this.onDidChangePluginsEmitter.fire();
  }

  public async remove(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      return;
    }
    if (entry.source === "builtin") {
      throw new Error(`Built-in plugin cannot be removed: ${id}`);
    }
    log(`[PluginRegistry] remove ${id}`);
    await this.deactivate(id);
    if (entry.directoryPath) {
      this.loader.clearCache(entry.directoryPath);
    }
    this.plugins.delete(id);
    await this.storage.removePlugin(id);
    await this.storage.forgetPlugin(id);
    this.onDidChangePluginsEmitter.fire();
  }

  public async importFromFolder(sourcePath: string): Promise<PluginRecord> {
    log(`[PluginRegistry] import from ${sourcePath}`);
    const pending = await this.loader.readManifest(sourcePath);
    if (this.builtins.has(pending.manifest.id)) {
      throw new Error(`Cannot replace built-in plugin: ${pending.manifest.id}`);
    }
    const installPath = await this.storage.installFromFolder(sourcePath, pending.manifest.id);
    this.loader.clearCache(installPath);
    const loaded = await this.loader.loadFromDirectory(installPath);
    await this.deactivate(loaded.manifest.id);
    this.registerLoadedLocalPlugin(loaded);
    if (!this.storage.getDisabledPluginIds().has(loaded.manifest.id)) {
      await this.activate(loaded.manifest.id);
    }
    const record = this.list().find((plugin) => plugin.id === loaded.manifest.id);
    if (!record) {
      throw new Error(`Plugin imported but missing from registry: ${loaded.manifest.id}`);
    }
    this.onDidChangePluginsEmitter.fire();
    return record;
  }

  public async loadInstalledLocalPlugins(): Promise<void> {
    const directories = await this.storage.listPluginDirectories();
    for (const directoryPath of directories) {
      try {
        debug(`[PluginRegistry] scan local plugin ${directoryPath}`);
        const loaded = await this.loader.loadFromDirectory(directoryPath);
        this.registerLoadedLocalPlugin(loaded);
      } catch (error) {
        const fallbackId = directoryPath.split(/[\\/]/).pop() || directoryPath;
        warn(`[PluginRegistry] failed to load local plugin ${directoryPath}: ${formatUnknown(error)}`);
        this.plugins.set(fallbackId, {
          source: "local",
          plugin: {
            manifest: {
              id: fallbackId,
              name: fallbackId,
              version: "unknown",
              main: "",
              apiVersion: "1.0",
              permissions: [],
            },
            activate() {
              throw new Error("Plugin failed to load");
            },
          },
          manifest: {
            id: fallbackId,
            name: fallbackId,
            version: "unknown",
            main: "",
            apiVersion: "1.0",
            permissions: [],
          },
          directoryPath,
          manifestPath: undefined,
          entryPath: undefined,
          lastError: formatUnknown(error),
        });
      }
    }
    this.onDidChangePluginsEmitter.fire();
  }

  public async dispose(): Promise<void> {
    for (const id of Array.from(this.active)) {
      await this.deactivate(id);
    }
    this.plugins.clear();
    this.active.clear();
    this.onDidChangePluginsEmitter.dispose();
    void this.context;
  }

  private registerLoadedLocalPlugin(loaded: LoadedLocalPlugin): void {
    this.register({
      source: "local",
      plugin: loaded.plugin,
      manifest: loaded.manifest,
      directoryPath: loaded.directoryPath,
      entryPath: loaded.entryPath,
      manifestPath: loaded.manifestPath,
    });
  }

  private register(entry: PluginEntry): void {
    const existing = this.plugins.get(entry.manifest.id);
    if (existing?.directoryPath && existing.directoryPath !== entry.directoryPath) {
      this.loader.clearCache(existing.directoryPath);
    }
    this.plugins.set(entry.manifest.id, entry);
    this.onDidChangePluginsEmitter.fire();
  }

  private toRecord(entry: PluginEntry, disabledIds: Set<string>): PluginRecord {
    const disabled = disabledIds.has(entry.manifest.id);
    const active = this.active.has(entry.manifest.id);
    return {
      id: entry.manifest.id,
      source: entry.source,
      manifest: entry.manifest,
      plugin: entry.plugin,
      directoryPath: entry.directoryPath,
      entryPath: entry.entryPath,
      manifestPath: entry.manifestPath,
      builtin: this.builtins.has(entry.manifest.id),
      enabled: !disabled,
      active,
      state: entry.lastError ? "error" : disabled ? "disabled" : active ? "active" : "inactive",
      lastError: entry.lastError,
    };
  }
}

function formatUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
