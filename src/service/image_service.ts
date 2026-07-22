import * as vscode from "vscode";
import express from "express";
import { log, warn } from "../logger";
import { WebSocket, WebSocketServer } from "ws";
import * as http from "http";
import { FrameSink } from "../ports/frame_sink";
import { Frame, FrameMetadata, FrameStore } from "./frame_store";
import { ConfigKeys, ConfigSection } from "../constants";

const EXPOSE_HEADERS =
  "X-Frame-Timestamp, X-Image-Width, X-Image-Height, X-Image-ColorSpace, X-Image-Format, ETag";

const WS_BUFFERED_LIMIT = 2 * 1024 * 1024;

interface WsClientState {
  key?: string;
  mode: "push" | "pull";
}

/**
 * Local HTTP + WebSocket + MJPEG adapters over a shared FrameStore.
 * Device frames enter via FrameSink.setImage (composition root).
 */
export class ImageService implements FrameSink {
  public readonly store: FrameStore;
  private readonly app = express();
  private server: http.Server | undefined;
  private wss: WebSocketServer | undefined;
  private readonly streamClients = new Map<string, Set<http.ServerResponse>>();
  private readonly wsState = new Map<WebSocket, WsClientState>();
  private port = 0;
  private storeUnsub: (() => void) | undefined;
  private listening = false;
  private readyResolve: (() => void) | undefined;
  private readonly readyPromise: Promise<void>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    store?: FrameStore
  ) {
    this.store = store ?? new FrameStore();
    this.mountRoutes();
    this.storeUnsub = this.store.subscribeAll((frame) => {
      this.pushWsFrame(frame);
      this.pushMjpegFrame(frame);
    });
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
    void this.startServer();
    context.subscriptions.push({
      dispose: () => this.dispose(),
    });
  }

  /** Resolves when the local HTTP/WS server is listening (or failed). */
  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  public getPort(): number {
    return this.port;
  }

  public getHttpBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  public getWsUrl(): string {
    return `ws://127.0.0.1:${this.port}`;
  }

  public setImage(
    key: string,
    imageData: ArrayBuffer,
    metadata?: FrameMetadata
  ): void {
    this.store.setImage(key, imageData, metadata);
  }

  public clearKey(key: string): void {
    this.store.clearKey(key);
    const clients = this.streamClients.get(key);
    if (clients) {
      for (const res of clients) {
        try {
          if (!res.destroyed) {
            res.end();
          }
        } catch {
          // ignore
        }
      }
      this.streamClients.delete(key);
    }
    for (const [ws, state] of this.wsState) {
      if (state.key === key && ws.readyState === WebSocket.OPEN) {
        this.sendJson(ws, { op: "error", error: "key_cleared", key });
      }
    }
  }

  public dispose(): void {
    this.storeUnsub?.();
    this.storeUnsub = undefined;

    this.streamClients.forEach((clients) => {
      clients.forEach((res) => {
        try {
          if (!res.destroyed) {
            res.end();
          }
        } catch {
          // ignore
        }
      });
    });
    this.streamClients.clear();

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = undefined;
    }
    this.wsState.clear();

    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
    this.listening = false;
    log("Image service disposed");
  }

  private preferredPort(): number {
    const cfg = vscode.workspace.getConfiguration(ConfigSection);
    const p = cfg.get<number>(ConfigKeys.imageServicePort, 9090);
    return typeof p === "number" && p >= 0 && p < 65536 ? p : 9090;
  }

  private async startServer(): Promise<void> {
    const preferred = this.preferredPort();
    const candidates =
      preferred === 0
        ? [0]
        : [preferred, 0];

    for (const tryPort of candidates) {
      try {
        await this.listen(tryPort);
        return;
      } catch (e) {
        warn(
          `Image service bind port ${tryPort} failed: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
    warn("Image service failed to start on any port");
    this.readyResolve?.();
    this.readyResolve = undefined;
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(this.app);
      const wss = new WebSocketServer({ noServer: true });
      this.attachWs(wss);

      server.on("upgrade", (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      });

      const onError = (err: Error) => {
        server.off("error", onError);
        try {
          server.close();
        } catch {
          // ignore
        }
        reject(err);
      };
      server.once("error", onError);

      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        const addr = server.address();
        this.port =
          typeof addr === "object" && addr ? addr.port : port;
        this.server = server;
        this.wss = wss;
        this.listening = true;
        log(`Image service listening on ${this.getHttpBaseUrl()}`);
        log(`- HTTP:  GET /image/:key  GET /stream/:key  GET /keys`);
        log(`- WS:    ${this.getWsUrl()}`);
        this.readyResolve?.();
        this.readyResolve = undefined;
        resolve();
      });
    });
  }

  private cors(res: express.Response): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", EXPOSE_HEADERS);
  }

  private setImageHeaders(res: express.Response, frame: Frame): void {
    this.cors(res);
    res.setHeader("Content-Type", frame.mime);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-Frame-Timestamp", frame.timestamp.toString());
    res.setHeader("ETag", `"${frame.timestamp}"`);
    if (frame.metadata?.width) {
      res.setHeader("X-Image-Width", frame.metadata.width.toString());
    }
    if (frame.metadata?.height) {
      res.setHeader("X-Image-Height", frame.metadata.height.toString());
    }
    if (frame.metadata?.colorSpace) {
      res.setHeader("X-Image-ColorSpace", frame.metadata.colorSpace);
    }
    if (frame.metadata?.format) {
      res.setHeader("X-Image-Format", frame.metadata.format);
    }
  }

  private mountRoutes(): void {
    this.app.use((_req, res, next) => {
      this.cors(res);
      if (_req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "If-None-Match, Content-Type"
        );
        res.status(204).end();
        return;
      }
      next();
    });

    this.app.get("/", (_req, res) => {
      res.json({
        service: "maixcode-image",
        port: this.port,
        keys: this.store.keys(),
        endpoints: {
          keys: "/keys",
          image: "/image/:key",
          stream: "/stream/:key",
          ws: this.getWsUrl(),
        },
      });
    });

    this.app.get("/keys", (_req, res) => {
      res.json(this.store.keys());
    });

    this.app.get("/image", (_req, res) => {
      res
        .status(400)
        .json({ error: "missing_key", hint: "GET /image/:key" });
    });

    this.app.head("/image/:key", (req, res) => {
      const key = decodeURIComponent(req.params.key);
      const frame = this.store.getFrame(key);
      if (!frame) {
        res.status(404).end();
        return;
      }
      this.setImageHeaders(res, frame);
      res.setHeader("Content-Length", frame.buffer.byteLength);
      res.status(200).end();
    });

    this.app.get("/image/:key", (req, res) => {
      const key = decodeURIComponent(req.params.key);
      const frame = this.store.getFrame(key);
      if (!frame) {
        this.cors(res);
        res.status(404).json({ error: "not_found", key });
        return;
      }

      const inm = req.headers["if-none-match"];
      if (inm && inm === `"${frame.timestamp}"`) {
        this.cors(res);
        res.status(304).end();
        return;
      }

      this.setImageHeaders(res, frame);
      res.status(200).end(Buffer.from(frame.buffer));
    });

    this.app.get("/stream/:key", (req, res) => {
      const key = decodeURIComponent(req.params.key);
      this.cors(res);
      res.setHeader(
        "Content-Type",
        "multipart/x-mixed-replace; boundary=frame"
      );
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.status(200);
      // flush headers
      res.write("");

      if (!this.streamClients.has(key)) {
        this.streamClients.set(key, new Set());
      }
      this.streamClients.get(key)!.add(res);

      const existing = this.store.getFrame(key);
      if (existing) {
        this.sendMjpegPart(res, existing);
      }

      const cleanup = () => {
        const set = this.streamClients.get(key);
        if (set) {
          set.delete(res);
          if (set.size === 0) {
            this.streamClients.delete(key);
          }
        }
      };
      req.on("close", cleanup);
      req.on("error", cleanup);
    });
  }

  private sendMjpegPart(res: http.ServerResponse, frame: Frame): boolean {
    if (res.destroyed || res.writableEnded) {
      return false;
    }
    try {
      const body = Buffer.from(frame.buffer);
      const headerLines = [
        "--frame",
        `Content-Type: ${frame.mime}`,
        `Content-Length: ${body.byteLength}`,
        `X-Frame-Timestamp: ${frame.timestamp}`,
      ];
      if (frame.metadata?.width) {
        headerLines.push(`X-Image-Width: ${frame.metadata.width}`);
      }
      if (frame.metadata?.height) {
        headerLines.push(`X-Image-Height: ${frame.metadata.height}`);
      }
      if (frame.metadata?.colorSpace) {
        headerLines.push(`X-Image-ColorSpace: ${frame.metadata.colorSpace}`);
      }
      if (frame.metadata?.format) {
        headerLines.push(`X-Image-Format: ${frame.metadata.format}`);
      }
      headerLines.push("", "");
      const ok = res.write(headerLines.join("\r\n"));
      res.write(body);
      res.write("\r\n");
      return ok !== false;
    } catch (e) {
      log(`MJPEG write error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private pushMjpegFrame(frame: Frame): void {
    const clients = this.streamClients.get(frame.key);
    if (!clients || clients.size === 0) {
      return;
    }
    for (const res of [...clients]) {
      if (res.destroyed || res.writableEnded) {
        clients.delete(res);
        continue;
      }
      // backpressure: skip if socket buffer is large
      const sock = res.socket;
      if (sock && sock.writableLength > WS_BUFFERED_LIMIT) {
        continue;
      }
      if (!this.sendMjpegPart(res, frame)) {
        clients.delete(res);
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    }
    if (clients.size === 0) {
      this.streamClients.delete(frame.key);
    }
  }

  private attachWs(wss: WebSocketServer): void {
    wss.on("connection", (ws) => {
      this.wsState.set(ws, { mode: "push" });
      this.sendJson(ws, { op: "hello", service: "maixcode-image" });

      ws.on("message", (raw, isBinary) => {
        if (isBinary) {
          return;
        }
        const text = raw.toString();
        let msg: { op?: string; key?: string; mode?: string };
        try {
          msg = JSON.parse(text) as { op?: string; key?: string; mode?: string };
        } catch {
          // legacy: plain key string => subscribe + one pull
          const key = text.trim();
          if (key) {
            this.wsSubscribe(ws, key, "pull");
            this.wsSendLatest(ws, key);
          }
          return;
        }

        const state = this.wsState.get(ws) ?? { mode: "push" as const };
        switch (msg.op) {
          case "subscribe": {
            if (!msg.key) {
              this.sendJson(ws, { op: "error", error: "missing_key" });
              break;
            }
            const mode = msg.mode === "pull" ? "pull" : "push";
            this.wsSubscribe(ws, msg.key, mode);
            this.sendJson(ws, {
              op: "ack",
              action: "subscribe",
              key: msg.key,
              mode,
            });
            if (mode === "push") {
              this.wsSendLatest(ws, msg.key);
            }
            break;
          }
          case "unsubscribe": {
            state.key = undefined;
            this.wsState.set(ws, state);
            this.sendJson(ws, { op: "ack", action: "unsubscribe" });
            break;
          }
          case "pull": {
            const key = msg.key || state.key;
            if (!key) {
              this.sendJson(ws, { op: "error", error: "missing_key" });
              break;
            }
            this.wsSendLatest(ws, key);
            break;
          }
          case "ping": {
            this.sendJson(ws, { op: "pong", t: Date.now() });
            break;
          }
          default:
            this.sendJson(ws, { op: "error", error: "unknown_op", detail: msg.op });
        }
      });

      ws.on("close", () => {
        this.wsState.delete(ws);
      });
      ws.on("error", (err) => {
        log(`Image WS client error: ${err.message}`);
        this.wsState.delete(ws);
      });
    });
  }

  private wsSubscribe(
    ws: WebSocket,
    key: string,
    mode: "push" | "pull"
  ): void {
    this.wsState.set(ws, { key, mode });
  }

  private wsSendLatest(ws: WebSocket, key: string): void {
    const frame = this.store.getFrame(key);
    if (!frame) {
      this.sendJson(ws, { op: "error", error: "not_found", key });
      return;
    }
    this.sendWsFrame(ws, frame);
  }

  private pushWsFrame(frame: Frame): void {
    for (const [ws, state] of this.wsState) {
      if (state.key !== frame.key || state.mode !== "push") {
        continue;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }
      if (ws.bufferedAmount > WS_BUFFERED_LIMIT) {
        continue;
      }
      this.sendWsFrame(ws, frame);
    }
  }

  private sendWsFrame(ws: WebSocket, frame: Frame): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.sendJson(ws, {
        op: "frame",
        key: frame.key,
        ts: frame.timestamp,
        mime: frame.mime,
        size: frame.buffer.byteLength,
        width: frame.metadata?.width,
        height: frame.metadata?.height,
        colorSpace: frame.metadata?.colorSpace,
        format: frame.metadata?.format,
      });
      ws.send(Buffer.from(frame.buffer));
    } catch (e) {
      log(`WS send error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private sendJson(ws: WebSocket, obj: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }
}
