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

  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
}
