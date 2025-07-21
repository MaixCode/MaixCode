import * as vscode from "vscode";
import dayjs from "dayjs";

let outputChannel: vscode.OutputChannel;

export function initLogger(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("MaixCode");
}

export function debug(message: string) {
  outputChannel.appendLine(
    `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Debug] ${message}`
  );
}

export function log(message: string) {
  outputChannel.appendLine(
    `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Info] ${message}`
  );
}

export function info(message: string) {
  outputChannel.appendLine(
    `[${dayjs().format("YYYY-MM-DD h:mm:ss")}][Info] ${message}`
  );
}

export function warn(message: string) {
  outputChannel.appendLine(
    `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Warning] ${message}`
  );
}

export function error(message: string | Error) {
  if (typeof message === "string") {
    outputChannel.appendLine(
      `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Error] ${message}`
    );
  } else {
    outputChannel.appendLine(
      `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Error] Catch an error: ${
        message.message
      }, \nstack: ${message.stack}`
    );
  }
  vscode.window
    .showErrorMessage("An error occurred, please check the log.", "Show Log")
    .then((selection) => {
      if (selection === "Show Log") {
        outputChannel.show();
      }
    });
}
