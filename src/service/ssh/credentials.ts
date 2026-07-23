import * as vscode from "vscode";
import { ConfigKeys, ConfigSection } from "../../constants";
import type { SshCredential } from "./types";

export function readSshCredentials(
  cfg?: vscode.WorkspaceConfiguration
): SshCredential[] {
  const c = cfg ?? vscode.workspace.getConfiguration(ConfigSection);
  const raw = c.get<unknown>(ConfigKeys.sshCredentials, []);
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SshCredential[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const o = item as Record<string, unknown>;
    const username = typeof o.username === "string" ? o.username.trim() : "";
    if (!username) {
      continue;
    }
    const password =
      typeof o.password === "string" ? o.password : undefined;
    const label = typeof o.label === "string" ? o.label : undefined;
    out.push({ username, password, label });
  }
  return out;
}
