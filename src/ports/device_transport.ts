import { DeviceInfo } from "../model/device";

/**
 * Narrow device control surface for run/debug sessions.
 * WebSocketService implements this; callers must not depend on full DeviceService.
 */
export interface DeviceTransport {
  readonly ip: string;
  readonly isConnected: boolean;
  readonly isRunning: boolean;
  deviceInfo?: DeviceInfo;

  runCode(code: string): void;
  stopCode(): void;
  /** Optional: send packaged project zip (RunProject cmd 18) */
  runProject?(zipData: Buffer): void;
  /** Optional: install app zip to device (InstallApp cmd 16) */
  installApp?(zipData: Buffer): void;
  /** Optional: install/update MaixVision runtime (UpdateRuntime cmd 19) */
  updateRuntime?(payload: Buffer): void;

  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
}
