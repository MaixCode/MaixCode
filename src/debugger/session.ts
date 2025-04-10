import * as vscode from "vscode";
import {
  DebugSession,
  InitializedEvent,
  OutputEvent,
  ProgressEndEvent,
  ExitedEvent,
  TerminatedEvent,
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { log } from "../logger";
import { Instance } from "../instance";
import { FileAccessor, MaixPyRuntime } from "./runtime";

interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** An absolute path to the "program" to debug. */
  program: string;
  /** If true, the launch request should launch the program without enabling debugging. */
  noDebug?: boolean;
}

export class MaixPyDebugSession extends DebugSession {
  private _runtime: MaixPyRuntime;

  constructor(fileAccessor: FileAccessor) {
    super();

    this._runtime = new MaixPyRuntime(fileAccessor);
    this._runtime.on("output", (type, text) => {
      let category: string;
      switch (type) {
        case "prio":
          category = "important";
          break;
        case "out":
          category = "stdout";
          break;
        case "err":
          category = "stderr";
          break;
        default:
          category = "console";
          break;
      }
      const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}`, category);

      if (text === "start" || text === "startCollapsed" || text === "end") {
        e.body.group = text;
        e.body.output = `group-${text}\n`;
      }

      // e.body.data = text;
      // Add timestamp
      e.body;
      this.sendEvent(e);
    });
    this._runtime.on("end", () => {
      this.sendEvent(new TerminatedEvent());
    });
  }

  /**
   * The 'initialize' request is the first request called by the frontend
   * to interrogate the features the debug adapter provides.
   */
  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ): void {
    if (args.supportsProgressReporting) {
      // this._reportProgress = true;
    }
    if (args.supportsInvalidatedEvent) {
      // this._useInvalidatedEvent = true;
    }

    // build and return the capabilities of this debug adapter:
    response.body = response.body || {};

    // the adapter implements the configurationDone request.
    /** 调试适配器支持 `configurationDone` 请求。 */
    response.body.supportsConfigurationDoneRequest = false;

    // make VS Code use 'evaluate' when hovering over source
    response.body.supportsEvaluateForHovers = false;

    // make VS Code show a 'step back' button
    response.body.supportsStepBack = false;

    // make VS Code support data breakpoints
    response.body.supportsDataBreakpoints = false;

    // make VS Code support completion in REPL
    response.body.supportsCompletionsRequest = false;
    response.body.completionTriggerCharacters = [];

    // make VS Code send cancel request
    response.body.supportsCancelRequest = false;
    response.body.supportsTerminateRequest = true;

    // make VS Code send the breakpointLocations request
    response.body.supportsBreakpointLocationsRequest = false;

    // make VS Code provide "Step in Target" functionality
    response.body.supportsStepInTargetsRequest = false;

    // the adapter defines two exceptions filters, one with support for conditions.
    response.body.supportsExceptionFilterOptions = false;
    response.body.exceptionBreakpointFilters = [];

    // make VS Code send exceptionInfo request
    response.body.supportsExceptionInfoRequest = false;

    // make VS Code send setVariable request
    response.body.supportsSetVariable = false;

    // make VS Code send setExpression request
    response.body.supportsSetExpression = false;

    // make VS Code send disassemble request
    response.body.supportsDisassembleRequest = false;
    response.body.supportsSteppingGranularity = false;
    response.body.supportsInstructionBreakpoints = false;

    // make VS Code able to read and write variable memory
    response.body.supportsReadMemoryRequest = false;
    response.body.supportsWriteMemoryRequest = false;

    response.body.supportSuspendDebuggee = false;
    response.body.supportTerminateDebuggee = false;
    response.body.supportsFunctionBreakpoints = false;
    response.body.supportsDelayedStackTraceLoading = false;

    this.sendResponse(response);

    // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
    // we request them early by sending an 'initializeRequest' to the frontend.
    // The frontend will end the configuration sequence by calling 'configurationDone' request.
    // 由于此调试适配器可以随时接受配置请求，如 'setBreakpoint'，
    // 我们通过发送 'initializeRequest' 到前端来提前请求它们。
    // 前端将通过调用 'configurationDone' 请求来结束配置序列。
    this.sendEvent(new InitializedEvent());
  }

  /**
   * Called at the end of the configuration sequence.
   * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
   */
  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    super.configurationDoneRequest(response, args);
  }

  // protected disconnectRequest(
  //   response: DebugProtocol.DisconnectResponse,
  //   args: DebugProtocol.DisconnectArguments,
  //   request?: DebugProtocol.Request
  // ): void {
  //   log(
  //     `disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`
  //   );
  // }

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: ILaunchRequestArguments,
    request?: DebugProtocol.Request
  ): void {
    // if (args.noDebug) {
    //   // no debug mode
    //   args;
    // }
    log("launchRequest");
    var currentDevice = Instance.instance.deviceManager.getConnectedDevice();
    if (currentDevice.length === 0) {
      // vscode.window.showErrorMessage("No device connected");
      this.sendErrorResponse(response, 0, "No device connected");
      return;
    }
    this._runtime.start(args.program, currentDevice[0]);

    this.sendResponse(response);
  }

  protected terminateRequest(
    response: DebugProtocol.TerminateResponse,
    args: DebugProtocol.TerminateArguments,
    request?: DebugProtocol.Request
  ): void {
    this._runtime.stop();

    this.sendResponse(response);
  }

  protected cancelRequest(
    response: DebugProtocol.CancelResponse,
    args: DebugProtocol.CancelArguments
  ) {
    log("cancelRequest");
  }
}
