import * as vscode from "vscode";
import express from "express";
import { log } from "../logger";
import { Readable } from "stream";
import { WebSocketServer } from "ws";

export class ImageService {
  private app = express();
  private imageMap: Map<string, ArrayBuffer> = new Map();
  private wss: WebSocketServer;

  constructor(private context: vscode.ExtensionContext, port: number = 9090) {
    this.app.get("/", (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(Array.from(this.imageMap.keys())));
    });

    this.app.get("/image", (req, res) => {
      res.send("Hello World!");
    });

    this.app.get("/image/:key", (req, res) => {
      const key = req.params.key;
      const imageData = this.imageMap.get(key);
      if (imageData) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const readable = new Readable();
        readable._read = () => {}; // _read is required but you can noop it
        readable.push(Buffer.from(imageData));
        readable.push(null); // 确保流结束
        readable.pipe(res);
      } else {
        log(`Image not found for key: ${key}`); // 添加日志
        res.status(404).send("Image not found");
      }
    });

    this.app.get("/view/:key", (req, res) => {
      const key = req.params.key;
      res.setHeader("Content-Type", "text/html");
      res.send(`
        <!DOCTYPE html>
        <html lang="zh-cn">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>查看图像</title>
        </head>
        <body>
          <h1>图像查看</h1>
          <div>
            <h2>HTTP 图像窗口</h2>
            <img id="http-image" alt="HTTP 图像加载中..." style="max-width: 100%; height: auto;">
            <div>帧率: <span id="http-fps">0</span> FPS</div>
            <div>帧大小: <span id="http-frameSize">0</span> KB</div>
          </div>
          <script>
            const key = "${key}";

            const httpImageElement = document.getElementById('http-image');
            const httpFpsElement = document.getElementById('http-fps');
            const httpFrameSizeElement = document.getElementById('http-frameSize');
            let httpLastFrameTime = performance.now();
            let httpFrameCount = 0;

            async function fetchHttpImage() {
              try {
                const response = await fetch('/image/' + key);
                if (!response.ok) {
                  throw new Error('Failed to fetch image: ' + response.statusText);
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                httpImageElement.src = url;

                const frameSize = (blob.size / 1024).toFixed(2);
                httpFrameSizeElement.innerText = frameSize;

                const currentTime = performance.now();
                httpFrameCount++;
                if (currentTime - httpLastFrameTime >= 1000) {
                  httpFpsElement.innerText = httpFrameCount;
                  httpFrameCount = 0;
                  httpLastFrameTime = currentTime;
                }

                setTimeout(() => URL.revokeObjectURL(url), 100);
              } catch (error) {
                console.error('Error fetching HTTP image:', error);
                httpImageElement.alt = 'HTTP 图像加载失败';
              } finally {
                setTimeout(fetchHttpImage, 100);
              }
            }

            fetchHttpImage();
          </script>
        </body>
        </html>
      `);
    });

    this.app.get("/stream/:key", (req, res) => {
      const key = req.params.key;
      const imageData = this.imageMap.get(key);
      if (!imageData) {
        res.status(404).send("Image not found");
        return;
      }

      res.setHeader(
        "Content-Type",
        "multipart/x-mixed-replace; boundary=frame"
      );
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const interval = setInterval(() => {
        const imageData = this.imageMap.get(key);
        if (imageData) {
          res.write(`--frame\r\n`);
          res.write(`Content-Type: image/jpeg\r\n\r\n`);
          res.write(Buffer.from(imageData));
          res.write(`\r\n`);
        } else {
          log(`Image data not found for key: ${key}`);
        }
      }, 100); // 调整间隔时间为 100ms

      req.on("close", () => {
        clearInterval(interval);
        log(`Stream closed for key: ${key}`);
      });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws) => {
      ws.on("message", (message) => {
        const key = message.toString();
        const imageData = this.imageMap.get(key);
        if (imageData) {
          const timestamp = Buffer.from(Date.now().toString());
          const dataWithTimestamp = Buffer.concat([
            Buffer.from(imageData),
            timestamp,
          ]);
          ws.send(dataWithTimestamp);
        }
      });
    });

    const server = this.app.listen(port, () => {
      log(`Image service is running on port ${port}`);
    });

    server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });
  }

  public setImage(key: string, imageData: ArrayBuffer) {
    this.imageMap.set(key, imageData);
    this.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        const timestamp = Buffer.from(Date.now().toString());
        const dataWithTimestamp = Buffer.concat([
          Buffer.from(imageData),
          timestamp,
        ]);
        client.send(dataWithTimestamp);
      }
    });
  }
}
