import * as vscode from "vscode";
import { MaixPyDebugSession } from "./session";
import { FileAccessor } from "./runtime";
import { error, formatUnknown, log, showLog } from "../logger";
import { DebugTypeName } from "../constants";

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

export class DebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    try {
      showLog();
      log(
        `[DebugAdapterFactory] create descriptor type=${session.type} name=${session.name} request=${session.configuration?.request}`
      );
      log(
        `[DebugAdapterFactory] configuration=${JSON.stringify(session.configuration)}`
      );
      log(`[DebugAdapterFactory] expected debug type=${DebugTypeName}`);

      if (session.type !== DebugTypeName) {
        warnTypeMismatch(session.type);
      }

      // Inline adapter only — never shell out to program/runtime from package.json
      const request = session.configuration?.request ?? "launch";
      if (request === "launch") {
        log("[DebugAdapterFactory] using inline MaixPyDebugSession");
        return new vscode.DebugAdapterInlineImplementation(
          new MaixPyDebugSession(workspaceFileAccessor)
        );
      }

      const msg = `Unsupported debug request: ${request} (only launch is supported)`;
      error(msg, true);
      vscode.window.showErrorMessage(msg);
      return undefined;
    } catch (e) {
      error(`[DebugAdapterFactory] failed: ${formatUnknown(e)}`, true);
      return undefined;
    }
  }
}

function warnTypeMismatch(type: string) {
  log(
    `[DebugAdapterFactory] WARNING session.type=${type} differs from ${DebugTypeName}`
  );
}
