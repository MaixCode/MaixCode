import * as vscode from "vscode";
import type { SshSession } from "./ssh_session";

/**
 * Bridges @cweijan/ssh2 shell stream to VS Code Pseudoterminal.
 */
export class SshPseudoTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<number | void>();
  private cols = 80;
  private rows = 24;
  private started = false;
  private closed = false;
  private disposables: { dispose(): void }[] = [];

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly session: SshSession,
    private readonly start: (dims: {
      cols: number;
      rows: number;
    }) => Promise<void>
  ) {}

  open(initialDimensions?: vscode.TerminalDimensions): void {
    if (initialDimensions) {
      this.cols = initialDimensions.columns;
      this.rows = initialDimensions.rows;
    }
    this.disposables.push(
      this.session.onData((data) => {
        this.writeEmitter.fire(data);
      }),
      this.session.onClose(() => {
        this.finish(0);
      }),
      this.session.onError((err) => {
        this.writeEmitter.fire(`\r\n[SSH error] ${err.message}\r\n`);
      })
    );
    if (this.started) {
      return;
    }
    this.started = true;
    void this.start({ cols: this.cols, rows: this.rows })
      .then(() => {
        // shell ready; session streams data via onData
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.writeEmitter.fire(`\r\n[SSH] ${msg}\r\n`);
        this.finish(1);
      });
  }

  close(): void {
    this.finish();
  }

  handleInput(data: string): void {
    this.session.write(data);
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.cols = dimensions.columns;
    this.rows = dimensions.rows;
    this.session.setWindow(this.cols, this.rows);
  }

  /** Write progress lines before shell is fully attached */
  writeLine(text: string): void {
    this.writeEmitter.fire(text);
  }

  private finish(code?: number): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this.disposables = [];
    this.session.dispose();
    this.closeEmitter.fire(code);
  }
}
