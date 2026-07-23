import axios from "axios";
import * as vscode from "vscode";
import { DeviceService } from "./device_service";
import { WebSocketService } from "./websocket_service";
import { DeviceInfo } from "../model/device";
import { error, formatUnknown, log, showLog } from "../logger";

const API_BASE = "https://maixvision.sipeed.com/api";
const API_TOKEN = "MaixVision2024";

/** Map device model string from device JSON to API `device` param */
const DeviceTypeMap: Record<string, string> = {
  MaixCAM2: "maixcam2",
  "MaixCAM-Pro": "maixcam",
  MaixCAM: "maixcam",
};

export type RuntimeVersionInfo = {
  current?: string;
  latest: string;
  needUpdate: boolean;
};

export type RuntimeServiceDeps = {
  getConnectedDevices: () => DeviceService[];
  getCurrentDevice: () => DeviceService | undefined;
};

/**
 * Fetch encrypted MaixVision runtime from Sipeed API and install via UpdateRuntime.
 * Mirrors MaixVision `device:update-runtime` flow.
 */
export class RuntimeService {
  private updating = false;

  constructor(private readonly deps: RuntimeServiceDeps) {}

  private pickDevice(): DeviceService | undefined {
    const connected = this.deps.getConnectedDevices();
    if (connected.length === 0) {
      vscode.window.showErrorMessage(
        "No device connected. Connect a MaixCAM from the MaixCode sidebar first."
      );
      return undefined;
    }
    const preferred = this.deps.getCurrentDevice();
    if (preferred && connected.includes(preferred)) {
      return preferred;
    }
    return connected[0];
  }

  private mapDeviceType(deviceModel?: string): string {
    if (!deviceModel) {
      return "maixcam";
    }
    return DeviceTypeMap[deviceModel] || "maixcam";
  }

  /**
   * Loose semver compare: returns true if latest > current (or current missing/invalid).
   * Avoids adding a semver dependency for this single check.
   */
  public needsUpdate(current: string | undefined, latest: string): boolean {
    const a = this.parseSemver(current);
    const b = this.parseSemver(latest);
    if (!b) {
      return false;
    }
    if (!a) {
      return true;
    }
    for (let i = 0; i < 3; i++) {
      if (b[i] > a[i]) {
        return true;
      }
      if (b[i] < a[i]) {
        return false;
      }
    }
    return false;
  }

  private parseSemver(v?: string): [number, number, number] | undefined {
    if (!v) {
      return undefined;
    }
    const m = String(v)
      .trim()
      .replace(/^v/i, "")
      .match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) {
      return undefined;
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  /**
   * Query latest runtime version for this device (uid + os + maixpy).
   */
  public async fetchLatestVersion(
    info: DeviceInfo
  ): Promise<RuntimeVersionInfo | undefined> {
    if (!info.apiKey) {
      return undefined;
    }
    try {
      const rsp = await axios.get(`${API_BASE}/v1/devices/encryption/version`, {
        headers: { token: API_TOKEN },
        params: {
          uid: info.apiKey,
          os: info.sysVer || "",
          maixpy: info.maixpyVer || "",
        },
        timeout: 30_000,
        validateStatus: () => true,
      });
      const data = rsp.data;
      if (!data || data.code !== 0 || !data.version) {
        log(
          `[Runtime] version API: code=${data?.code} version=${data?.version}`
        );
        return undefined;
      }
      const latest = String(data.version);
      if (!this.parseSemver(latest)) {
        return undefined;
      }
      const needUpdate = this.needsUpdate(info.runtime, latest);
      return {
        current: info.runtime,
        latest,
        needUpdate,
      };
    } catch (e) {
      error(`[Runtime] fetchLatestVersion failed: ${formatUnknown(e)}`);
      return undefined;
    }
  }

  /**
   * Download encrypted firmware bytes for (uid, deviceType, version).
   */
  public async downloadFirmware(
    uid: string,
    deviceType: string,
    version: string
  ): Promise<Buffer> {
    const response = await axios.get(
      `${API_BASE}/v1/devices/encryption`,
      {
        headers: { token: API_TOKEN },
        params: { uid, device: deviceType, version },
        responseType: "arraybuffer",
        timeout: 120_000,
        validateStatus: () => true,
      }
    );
    const ct = String(response.headers["content-type"] || "");
    if (response.status !== 200 || !ct.includes("application/octet-stream")) {
      let detail = "";
      try {
        detail = Buffer.from(response.data).toString("utf8").slice(0, 200);
      } catch {
        // ignore
      }
      throw new Error(
        `Runtime download failed (HTTP ${response.status}, content-type=${ct})${
          detail ? `: ${detail}` : ""
        }`
      );
    }
    return Buffer.from(response.data);
  }

  /** Build UpdateRuntime payload: version + NUL + firmware */
  public buildPayload(version: string, firmware: Buffer): Buffer {
    const versionBuffer = Buffer.from(`${version}\0`);
    return Buffer.concat([versionBuffer, firmware]);
  }

  /**
   * Sidebar entry: check latest, confirm, download, push UpdateRuntime, wait progress.
   */
  public async installOrUpdateRuntime(): Promise<void> {
    if (this.updating) {
      vscode.window.showWarningMessage(
        "A runtime install is already in progress."
      );
      return;
    }

    const device = this.pickDevice();
    if (!device?.wss?.isConnected) {
      vscode.window.showErrorMessage("Device is not connected.");
      return;
    }
    const wss = device.wss;
    if (typeof wss.updateRuntime !== "function") {
      vscode.window.showErrorMessage(
        "Transport does not support updateRuntime."
      );
      return;
    }

    const info = device.getDeviceInfo();
    if (!info?.apiKey) {
      vscode.window.showErrorMessage(
        "Device has no apiKey. Wait for device info after connect, then retry."
      );
      return;
    }

    this.updating = true;
    showLog();
    log(
      `[Runtime] install start ip=${device.device?.ip} apiKey=${info.apiKey.slice(
        0,
        6
      )}… model=${info.device || "?"} current=${info.runtime || "(none)"}`
    );

    try {
      const versionInfo = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Checking runtime version…",
          cancellable: false,
        },
        async () => this.fetchLatestVersion(info)
      );

      if (!versionInfo) {
        vscode.window.showErrorMessage(
          "Could not query latest runtime version from Sipeed API."
        );
        return;
      }

      if (!versionInfo.needUpdate) {
        const stay = await vscode.window.showInformationMessage(
          `Runtime is up to date (${versionInfo.current || versionInfo.latest}). Reinstall ${versionInfo.latest}?`,
          "Reinstall",
          "Cancel"
        );
        if (stay !== "Reinstall") {
          return;
        }
      } else {
        const currentLabel = versionInfo.current || "not installed";
        const go = await vscode.window.showInformationMessage(
          `Install Runtime ${versionInfo.latest}? (current: ${currentLabel})`,
          "Install",
          "Cancel"
        );
        if (go !== "Install") {
          return;
        }
      }

      const deviceType = this.mapDeviceType(info.device);
      const firmware = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading Runtime ${versionInfo.latest}…`,
          cancellable: false,
        },
        async () =>
          this.downloadFirmware(info.apiKey!, deviceType, versionInfo.latest)
      );

      log(
        `[Runtime] downloaded ${firmware.length} bytes for ${deviceType} v${versionInfo.latest}`
      );
      const payload = this.buildPayload(versionInfo.latest, firmware);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing Runtime ${versionInfo.latest}…`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: "0%" });
          await this.sendUpdateAndWait(wss, payload, (pct) => {
            progress.report({ message: `${pct}%` });
          });
        }
      );

      vscode.window.showInformationMessage(
        `Runtime ${versionInfo.latest} installed on device.`
      );
      log(`[Runtime] install complete v${versionInfo.latest}`);
    } catch (e) {
      error(`[Runtime] install failed: ${formatUnknown(e)}`, true);
    } finally {
      this.updating = false;
    }
  }

  private sendUpdateAndWait(
    wss: WebSocketService,
    payload: Buffer,
    onProgress: (pct: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      // Runtime flash can be slow
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error("Runtime install timed out (no UpdateRuntimeAck within 300s)")
        );
      }, 300_000);

      const onUpdate = (rsp: {
        code?: number;
        progress?: number;
        msg?: string;
      }) => {
        if (done) {
          return;
        }
        if (rsp.code !== 0) {
          cleanup();
          reject(new Error(rsp.msg || "Runtime install failed"));
          return;
        }
        const pct = typeof rsp.progress === "number" ? rsp.progress : 0;
        onProgress(pct);
        log(`[Runtime] install progress ${pct}%`);
        if (pct >= 100) {
          cleanup();
          resolve();
        }
      };
      const onError = (err: unknown) => {
        if (done) {
          return;
        }
        cleanup();
        reject(new Error(formatUnknown(err)));
      };
      const onClose = () => {
        if (done) {
          return;
        }
        cleanup();
        reject(new Error("Device disconnected during runtime install"));
      };

      const cleanup = () => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timeout);
        wss.off("updateRuntime", onUpdate);
        wss.off("error", onError);
        wss.off("close", onClose);
      };

      wss.on("updateRuntime", onUpdate);
      wss.on("error", onError);
      wss.on("close", onClose);
      wss.updateRuntime(payload);
    });
  }
}
