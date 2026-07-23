import * as vscode from "vscode";
import dayjs from "dayjs";

let outputChannel: vscode.LogOutputChannel | undefined;

function stamp(level: string, message: string) {
  return `[${dayjs().format("YYYY-MM-DD HH:mm:ss")}][${level}] ${message}`;
}

export function initLogger(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("MaixCode", { log: true });
  context.subscriptions.push(outputChannel);
  // Ensure early activation is visible even if user never opens the panel
  console.log(stamp("Info", "Logger initialized"));
}

export function showLog() {
  try {
    outputChannel?.show(true);
  } catch {
    // ignore
  }
}

export function debug(message: string) {
  const line = stamp("Debug", message);
  console.log(line);
  try {
    outputChannel?.debug(message);
  } catch {
    // ignore
  }
}

export function log(message: string) {
  const line = stamp("Info", message);
  console.log(line);
  try {
    outputChannel?.info(message);
  } catch {
    // ignore
  }
}

export function info(message: string) {
  log(message);
}

export function warn(message: string) {
  const line = stamp("Warn", message);
  console.warn(line);
  try {
    outputChannel?.warn(message);
  } catch {
    // ignore
  }
}

/**
 * Log an error without always popping a modal (use notify=true for user-facing failures).
 */
export function error(message: string | Error, notify = false) {
  const text =
    typeof message === "string"
      ? message
      : `Catch an error: ${message.message}\nstack: ${message.stack}`;
  const line = stamp("Error", text);
  console.error(line);
  try {
    if (typeof message === "string") {
      outputChannel?.error(message);
    } else {
      outputChannel?.error(text);
    }
  } catch {
    // ignore
  }

  if (notify) {
    vscode.window
      .showErrorMessage(
        vscode.l10n.t(
          "MaixCode: {0}",
          typeof message === "string" ? message : message.message
        ),
        vscode.l10n.t("Show Log")
      )
      .then((selection) => {
        if (selection === vscode.l10n.t("Show Log")) {
          showLog();
        }
      });
  }
}

export function formatUnknown(err: unknown): string {
  if (err instanceof Error) {
    return `${err.message}${err.stack ? `\n${err.stack}` : ""}`;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
