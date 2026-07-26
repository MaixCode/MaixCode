import * as vscode from "vscode";
import { DevicePluginHost } from "./types";
import { DevicePlugin } from "./types";

export class PluginRegistry implements vscode.Disposable {
  private readonly plugins = new Map<string, DevicePlugin>();
  private readonly active = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: DevicePluginHost
  ) {}

  register(plugin: DevicePlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
  }

  async activateAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (this.active.has(plugin.manifest.id)) {
        continue;
      }
      await plugin.activate(this.host);
      this.active.add(plugin.manifest.id);
    }
  }

  list(): DevicePlugin[] {
    return Array.from(this.plugins.values());
  }

  async dispose(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (!this.active.has(plugin.manifest.id)) {
        continue;
      }
      await plugin.deactivate?.();
    }
    this.plugins.clear();
    this.active.clear();
    void this.context;
  }
}
