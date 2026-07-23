import * as vscode from "vscode";
import { MaixPyDebugSession } from "./session";
import { error, formatUnknown, log, showLog } from "../logger";
import { DebugTypeName } from "../constants";
import { workspaceFileAccessor } from "./file_accessor";

export { workspaceFileAccessor } from "./file_accessor";

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
