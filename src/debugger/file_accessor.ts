import * as vscode from "vscode";
import { error, formatUnknown, log } from "../logger";
import { FileAccessor } from "./runtime";

function pathToUri(path: string) {
  try {
    return vscode.Uri.file(path);
  } catch (e) {
    return vscode.Uri.parse(path);
  }
}

export const workspaceFileAccessor: FileAccessor = {
  isWindows: typeof process !== "undefined" && process.platform === "win32",
  async readFile(path: string): Promise<Uint8Array> {
    log(`[FileAccessor] readFile: ${path}`);
    let uri: vscode.Uri;
    try {
      uri = pathToUri(path);
    } catch (e) {
      error(`[FileAccessor] pathToUri failed: ${formatUnknown(e)}`);
      throw new Error(`cannot resolve path '${path}': ${formatUnknown(e)}`);
    }

    try {
      const data = await vscode.workspace.fs.readFile(uri);
      log(`[FileAccessor] readFile ok: ${path} (${data.byteLength} bytes)`);
      return data;
    } catch (e) {
      error(`[FileAccessor] readFile failed: ${path}: ${formatUnknown(e)}`);
      throw e;
    }
  },
  async writeFile(path: string, contents: Uint8Array) {
    log(`[FileAccessor] writeFile: ${path} (${contents.byteLength} bytes)`);
    await vscode.workspace.fs.writeFile(pathToUri(path), contents);
  },
};
