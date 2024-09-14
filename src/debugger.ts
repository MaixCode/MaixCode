import * as vscode from "vscode";
import { DebugSession, InitializedEvent } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";

export class DebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    _session: vscode.DebugSession
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(
      new MaixPyDebugSession()
    );
  }
}

export class MaixPyDebugSession extends DebugSession {
  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments,
    request?: DebugProtocol.Request
  ): void {
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }
}
