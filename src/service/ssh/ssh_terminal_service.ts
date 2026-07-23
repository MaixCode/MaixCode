import * as vscode from "vscode";
import { ConfigKeys, ConfigSection } from "../../constants";
import { error, formatUnknown, log } from "../../logger";
import { SshPseudoTerminal } from "./ssh_pseudo_terminal";
import { SshSession } from "./ssh_session";
import type { OpenSshTerminalRequest, SshCredential } from "./types";

type SessionHandle = {
  id: string;
  terminal: vscode.Terminal;
  session: SshSession;
};

/**
 * Manages multiple SSH terminals (one new session per open).
 */
export class SshTerminalService {
  private sessions = new Map<string, SessionHandle>();
  private nextSeq = 1;
  private disposed = false;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  async open(req: OpenSshTerminalRequest): Promise<void> {
    if (this.disposed) {
      throw new Error("SshTerminalService disposed");
    }
    const host = (req.host || "").trim();
    if (!host) {
      vscode.window.showErrorMessage("No device IP for SSH terminal");
      return;
    }

    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const port =
      req.port ??
      cfg.get<number>(ConfigKeys.sshPort, 22);
    const timeoutMs = cfg.get<number>(ConfigKeys.sshConnectTimeoutMs, 10000);
    const credentials = readCredentials(cfg);

    if (!credentials.length) {
      const pick = await vscode.window.showErrorMessage(
        "No SSH credentials configured (maixcode.sshCredentials).",
        "Open Settings"
      );
      if (pick === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "maixcode.sshCredentials"
        );
      }
      return;
    }

    const seq = this.nextSeq++;
    const label = req.deviceName?.trim() || host;
    const title = `MaixSSH: ${label} #${seq}`;
    const id = `ssh-${host}-${seq}`;

    const session = new SshSession();
    let ptyRef: SshPseudoTerminal | undefined;

    const pty = new SshPseudoTerminal(session, async (dims) => {
      log(`[SSH] connecting ${host}:${port} session=${id}`);
      ptyRef?.writeLine(`Connecting to ${host}:${port}...\r\n`);
      await session.connectWithCredentialFallback({
        host,
        port,
        timeoutMs,
        credentials,
        onProgress: (line) => ptyRef?.writeLine(line),
      });
      await session.openShell(dims);
      log(`[SSH] shell open session=${id}`);
    });
    ptyRef = pty;

    const terminal = vscode.window.createTerminal({
      name: title,
      pty,
    });

    const handle: SessionHandle = { id, terminal, session };
    this.sessions.set(id, handle);

    const sub = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) {
        this.dropSession(id);
        sub.dispose();
      }
    });

    terminal.show(true);
    log(`[SSH] terminal opened ${title}`);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.sessions.keys()]) {
      this.dropSession(id);
    }
  }

  private dropSession(id: string): void {
    const h = this.sessions.get(id);
    if (!h) {
      return;
    }
    this.sessions.delete(id);
    try {
      h.session.dispose();
    } catch (e) {
      error(`[SSH] dispose session ${id}: ${formatUnknown(e)}`);
    }
    log(`[SSH] session closed ${id}`);
  }
}

function readCredentials(
  cfg: vscode.WorkspaceConfiguration
): SshCredential[] {
  const raw = cfg.get<unknown>(ConfigKeys.sshCredentials, []);
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
