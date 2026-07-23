import * as vscode from "vscode";
import {
  DebugSession,
  InitializedEvent,
  OutputEvent,
  TerminatedEvent,
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { error, formatUnknown, log, showLog } from "../logger";
import { Instance } from "../instance";
import { FileAccessor, MaixPyRuntime } from "./runtime";
import { Status } from "../model/status";
import { DeviceService } from "../service/device_service";
import {
  ProjectPackageService,
  RUN_PROJECT_BLOCK_MB,
  RUN_PROJECT_WARN_MB,
} from "../service/project_package_service";
import * as fs from "fs";
import * as path from "path";

interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
  /** Absolute path to the Python file, or project root when mode is "project". */
  program: string;
  /** If true, the launch request should launch the program without enabling debugging. */
  noDebug?: boolean;
  /**
   * "file" (default): run program source via Run.
   * "project": RunProject zip (projectZip or package projectDir).
   */
  mode?: "file" | "project";
  /** Project root for Run Project (app with main.py). */
  projectDir?: string;
  /** Pre-built zip path for Run Project (tmp zip from ProjectPackageService). */
  projectZip?: string;
}

export class MaixPyDebugSession extends DebugSession {
  private _runtime: MaixPyRuntime;
  private _launched = false;

  constructor(fileAccessor: FileAccessor) {
    super();

    log("[MaixPyDebugSession] constructor");
    this._runtime = new MaixPyRuntime(fileAccessor);

    this._runtime.on("output", (type: string, text: unknown) => {
      try {
        const message =
          typeof text === "string"
            ? text
            : text instanceof Error
              ? text.message
              : formatUnknown(text);
        // Always append newline so Debug Console is readable
        const line = message.endsWith("\n") ? message : `${message}\n`;

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

        log(`[MaixPyDebugSession] runtime output type=${type} category=${category}: ${message.slice(0, 200)}`);
        this.sendEvent(new OutputEvent(line, category));
      } catch (e) {
        error(`[MaixPyDebugSession] output handler failed: ${formatUnknown(e)}`);
      }
    });

    this._runtime.on("end", () => {
      log("[MaixPyDebugSession] runtime end -> TerminatedEvent");
      this.sendEvent(new TerminatedEvent());
    });
  }

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    args: DebugProtocol.InitializeRequestArguments
  ): void {
    log(
      `[MaixPyDebugSession] initializeRequest clientID=${args.clientID} adapterID=${args.adapterID}`
    );

    response.body = response.body || {};
    response.body.supportsConfigurationDoneRequest = false;
    response.body.supportsEvaluateForHovers = false;
    response.body.supportsStepBack = false;
    response.body.supportsDataBreakpoints = false;
    response.body.supportsCompletionsRequest = false;
    response.body.completionTriggerCharacters = [];
    response.body.supportsCancelRequest = false;
    response.body.supportsTerminateRequest = true;
    response.body.supportsBreakpointLocationsRequest = false;
    response.body.supportsStepInTargetsRequest = false;
    response.body.supportsExceptionFilterOptions = false;
    response.body.exceptionBreakpointFilters = [];
    response.body.supportsExceptionInfoRequest = false;
    response.body.supportsSetVariable = false;
    response.body.supportsSetExpression = false;
    response.body.supportsDisassembleRequest = false;
    response.body.supportsSteppingGranularity = false;
    response.body.supportsInstructionBreakpoints = false;
    response.body.supportSuspendDebuggee = false;
    response.body.supportTerminateDebuggee = true;
    response.body.supportsFunctionBreakpoints = false;
    response.body.supportsDelayedStackTraceLoading = false;

    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
    log("[MaixPyDebugSession] initializeRequest done + InitializedEvent");
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    log("[MaixPyDebugSession] configurationDoneRequest");
    super.configurationDoneRequest(response, args);
  }

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: ILaunchRequestArguments,
    request?: DebugProtocol.Request
  ): void {
    showLog();
    log("[MaixPyDebugSession] ===== launchRequest begin =====");
    log(`[MaixPyDebugSession] args=${JSON.stringify(args)}`);
    log(`[MaixPyDebugSession] program=${args?.program} noDebug=${args?.noDebug}`);

    try {
      if (!args?.program) {
        const msg = "launch.json missing required 'program' path";
        error(msg, true);
        this.consoleError(msg);
        this.sendErrorResponse(response, 1, msg);
        return;
      }

      if (!Instance.instance) {
        const msg = "MaixCode Instance is not initialized (extension activate failed?)";
        error(msg, true);
        this.consoleError(msg);
        this.sendErrorResponse(response, 2, msg);
        return;
      }

      const manager = Instance.instance.deviceManager;
      const allDevices = manager.getDeviceList();
      const connected = manager.getConnectedDevice();
      const preferred = manager.getCurrentDevice();

      log(
        `[MaixPyDebugSession] devices: total=${allDevices.length} connected=${connected.length} hasCurrent=${!!preferred}`
      );
      for (const d of allDevices) {
        const name = d.device?.name ?? "?";
        const ip = d.device?.ip ?? "?";
        const st = Status[d.status] ?? d.status;
        const ws = d.wss
          ? `wss=yes isConnected=${d.wss.isConnected} isRunning=${d.wss.isRunning}`
          : "wss=no";
        log(`[MaixPyDebugSession]   device ${name}@${ip} status=${st} ${ws}`);
      }

      if (connected.length === 0) {
        const msg =
          "No device connected. Connect a MaixCAM from the MaixCode sidebar first.";
        error(msg, true);
        this.consoleError(msg);
        this.sendErrorResponse(response, 3, msg);
        return;
      }

      const device =
        preferred && connected.includes(preferred) ? preferred : connected[0];
      log(
        `[MaixPyDebugSession] selected device ${device.device?.name}@${device.device?.ip} status=${Status[device.status]} transport=${!!device.transport} wss=${!!device.wss}`
      );

      this._launched = true;
      this.sendResponse(response);
      log("[MaixPyDebugSession] launchResponse sent, starting runtime...");

      const mode = args.mode === "project" ? "project" : "file";
      if (mode === "project") {
        void this.launchProject(args, device);
      } else {
        this.consoleLog(`Starting ${args.program} on ${device.device?.ip}...`);
        void this._runtime
          .start(args.program, device)
          .then(() => {
            log("[MaixPyDebugSession] runtime.start() promise resolved");
          })
          .catch((e) => {
            const msg = `runtime.start failed: ${formatUnknown(e)}`;
            error(msg, true);
            this.consoleError(msg);
            this.sendEvent(new TerminatedEvent());
          });
      }
    } catch (e) {
      const msg = `launchRequest exception: ${formatUnknown(e)}`;
      error(msg, true);
      this.consoleError(msg);
      try {
        this.sendErrorResponse(response, 99, msg);
      } catch {
        this.sendEvent(new TerminatedEvent());
      }
    }
  }

  protected terminateRequest(
    response: DebugProtocol.TerminateResponse,
    args: DebugProtocol.TerminateArguments,
    request?: DebugProtocol.Request
  ): void {
    log(`[MaixPyDebugSession] terminateRequest launched=${this._launched}`);
    // Respond first so UI stays responsive; then stop device and terminate session
    this.sendResponse(response);
    void this.shutdownDebug("terminate");
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    args: DebugProtocol.DisconnectArguments,
    request?: DebugProtocol.Request
  ): void {
    log(
      `[MaixPyDebugSession] disconnectRequest terminateDebuggee=${args.terminateDebuggee} suspend=${args.suspendDebuggee}`
    );
    this.sendResponse(response);
    // VS Code may send disconnect without waiting for TerminatedEvent on first click;
    // always end the debug session after stop.
    void this.shutdownDebug("disconnect");
  }


  private async launchProject(
    args: ILaunchRequestArguments,
    device: DeviceService
  ): Promise<void> {
    try {
      const projectDir = args.projectDir || args.program;
      if (!projectDir || !fs.existsSync(projectDir)) {
        const msg = `Project directory not found: ${projectDir || "(empty)"}`;
        error(msg, true);
        this.consoleError(msg);
        this.sendEvent(new TerminatedEvent());
        return;
      }

      let zipPath: string | undefined = args.projectZip;
      if (!zipPath || !fs.existsSync(zipPath)) {
        const packages = new ProjectPackageService();
        const mainOk = await packages.ensureMainPy(projectDir);
        if (!mainOk) {
          const msg = `main.py not found in ${projectDir}`;
          error(msg, true);
          this.consoleError(msg);
          this.sendEvent(new TerminatedEvent());
          return;
        }
        this.consoleLog(`Packaging project ${projectDir}...`);
        const packed = await packages.packageFolderForRun(projectDir);
        if (!packed.ok) {
          const msg = `Package project failed: ${packed.message}`;
          error(msg, true);
          this.consoleError(msg);
          this.sendEvent(new TerminatedEvent());
          return;
        }
        const sizeMb = packed.info.size / 1024 / 1024;
        if (sizeMb > RUN_PROJECT_BLOCK_MB) {
          const msg = `Project zip is ${sizeMb.toFixed(1)} MB (limit ${RUN_PROJECT_BLOCK_MB} MB)`;
          error(msg, true);
          this.consoleError(msg);
          this.sendEvent(new TerminatedEvent());
          return;
        }
        if (sizeMb > RUN_PROJECT_WARN_MB) {
          this.consoleLog(
            `Warning: project zip is ${sizeMb.toFixed(1)} MB (over ${RUN_PROJECT_WARN_MB} MB)`
          );
        }
        zipPath = packed.info.path;
      }

      if (!zipPath) {
        const msg = "Project zip path is missing";
        error(msg, true);
        this.consoleError(msg);
        this.sendEvent(new TerminatedEvent());
        return;
      }

      const zipData = await fs.promises.readFile(zipPath);
      const label = `${path.basename(projectDir)}.zip`;
      this.consoleLog(
        `Starting project ${label} (${zipData.length} bytes) on ${device.device?.ip}...`
      );
      log(
        `[MaixPyDebugSession] launchProject zip=${zipPath} bytes=${zipData.length}`
      );
      await this._runtime.startProject(zipData, device, label);
      log("[MaixPyDebugSession] runtime.startProject() promise resolved");
    } catch (e) {
      const msg = `runtime.startProject failed: ${formatUnknown(e)}`;
      error(msg, true);
      this.consoleError(msg);
      this.sendEvent(new TerminatedEvent());
    }
  }

  private _shuttingDown = false;

  private async shutdownDebug(reason: string): Promise<void> {
    if (this._shuttingDown) {
      log(`[MaixPyDebugSession] shutdownDebug already in progress (${reason})`);
      return;
    }
    this._shuttingDown = true;
    log(`[MaixPyDebugSession] shutdownDebug begin reason=${reason}`);
    try {
      // Stop device and emit end -> TerminatedEvent (via runtime "end" handler)
      await this._runtime.requestStop(true);
      this._runtime.dispose();
    } catch (e) {
      error(`[MaixPyDebugSession] shutdownDebug failed: ${formatUnknown(e)}`);
      this.sendEvent(new TerminatedEvent());
    }
    log(`[MaixPyDebugSession] shutdownDebug done reason=${reason}`);
  }

  protected cancelRequest(
    response: DebugProtocol.CancelResponse,
    args: DebugProtocol.CancelArguments
  ) {
    log(`[MaixPyDebugSession] cancelRequest ${JSON.stringify(args)}`);
    this.sendResponse(response);
  }

  private consoleLog(message: string) {
    this.sendEvent(new OutputEvent(`${message}\n`, "console"));
  }

  private consoleError(message: string) {
    this.sendEvent(new OutputEvent(`${message}\n`, "stderr"));
  }
}
