import * as vscode from "vscode";
import dayjs from "dayjs";

let outputChannel: vscode.LogOutputChannel;

export function initLogger(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("MaixCode", {log: true});
}

export function debug(message: string) {
  outputChannel.debug(message);
  // console.debug(`[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Debug] ${message}`);
}

export function log(message: string) {
  outputChannel.info(message);
}

export function info(message: string) {
  outputChannel.info(message);
}

export function warn(message: string) {
  outputChannel.warn(message);
  console.warn(`[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Warn] ${message}`);
}

export function error(message: string | Error) {
  // if (typeof message === "string") {
  //   outputChannel.appendLine(
  //     `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Error] ${message}`
  //   );
  // } else {
  //   outputChannel.appendLine(
  //     `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Error] Catch an error: ${
  //       message.message
  //     }, \nstack: ${message.stack}`
  //   );
  // }
  if (typeof message === "string") {
    outputChannel.error(message);
    console.error(`[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Error] ${message}`);
  } else {
    outputChannel.error(`Catch an error: ${message.message}, \nstack: ${message.stack}`);
    console.error(
      `[${dayjs().format("YYYY-MM-DD hh:mm:ss")}][Error] Catch an error: ${message.message}, \nstack: ${message.stack}`
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
