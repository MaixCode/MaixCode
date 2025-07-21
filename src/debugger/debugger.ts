import * as vscode from "vscode";
import { MaixPyDebugSession } from "./session";
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
    let uri: vscode.Uri;
    try {
      uri = pathToUri(path);
    } catch (e) {
      return new TextEncoder().encode(`cannot read '${path}'`);
    }

    return await vscode.workspace.fs.readFile(uri);
  },
  async writeFile(path: string, contents: Uint8Array) {
    await vscode.workspace.fs.writeFile(pathToUri(path), contents);
  },
};

export class DebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (_session.configuration.request === "launch") {
      return new vscode.DebugAdapterInlineImplementation(
        new MaixPyDebugSession(workspaceFileAccessor)
      );
    } else {
      vscode.window.showErrorMessage("Unknown debug request name");
      return undefined;
    }
  }
}
