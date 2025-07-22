import * as vscode from "vscode";
import express from "express";
import { log } from "../logger";
import { Readable } from "stream";
import { WebSocketServer } from "ws";
import * as http from "http";

interface ImageData {
  buffer: ArrayBuffer;
  timestamp: number;
  metadata?: {
    width?: number;
    height?: number;
    colorSpace?: string;
    format?: string;
  };
}

export class ImageService {
  private app = express();
  private server: http.Server;
  private imageMap: Map<string, ImageData> = new Map();
  private wss: WebSocketServer;
  private streamClients: Map<string, Set<http.ServerResponse>> = new Map();

  constructor(private context: vscode.ExtensionContext, port: number = 9090) {
    // 根路径：返回所有图像键列表
    this.app.get("/", (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(Array.from(this.imageMap.keys())));
    });

    // 单次图像获取接口
    this.app.get("/image", (req, res) => {
      res.send("Image Service API - use /image/:key to get specific image");
    });

    // 获取指定键的图像数据
    this.app.get("/image/:key", (req, res) => {
      const key = req.params.key;
      const imageData = this.imageMap.get(key);
      if (imageData) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("X-Frame-Timestamp", imageData.timestamp.toString());
        
        // 添加图像元数据头
        if (imageData.metadata) {
          if (imageData.metadata.width) res.setHeader("X-Image-Width", imageData.metadata.width.toString());
          if (imageData.metadata.height) res.setHeader("X-Image-Height", imageData.metadata.height.toString());
          if (imageData.metadata.colorSpace) res.setHeader("X-Image-ColorSpace", imageData.metadata.colorSpace);
          if (imageData.metadata.format) res.setHeader("X-Image-Format", imageData.metadata.format);
        }
        
        res.end(Buffer.from(imageData.buffer));
      } else {
        log(`Image not found for key: ${key}`);
        res.status(404).json({ error: "Image not found", key });
      }
    });

    // 图像查看界面（包含HTTP和WebSocket测试）
    this.app.get("/view/:key", (req, res) => {
      const key = req.params.key;
      res.setHeader("Content-Type", "text/html");
      res.send(`
        <!DOCTYPE html>
        <html lang="zh-cn">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>图像流查看器 - ${key}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 30px; }
            .tabs { display: flex; margin-bottom: 20px; border-bottom: 2px solid #ddd; }
            .tab { padding: 10px 20px; cursor: pointer; border: none; background: none; }
            .tab.active { background: #007acc; color: white; }
            .content { display: none; }
            .content.active { display: block; }
            .image-container { text-align: center; margin-bottom: 20px; }
            .image-container img { max-width: 100%; height: auto; border: 2px solid #ddd; background: #fff; }
            .metrics { display: flex; justify-content: space-around; background: #fff; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .metric { text-align: center; }
            .metric-value { font-size: 24px; font-weight: bold; color: #007acc; }
            .metric-label { font-size: 12px; color: #666; }
            .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
            .status.connected { background: #d4edda; color: #155724; }
            .status.error { background: #f8d7da; color: #721c24; }
            .controls { margin: 20px 0; }
            .btn { padding: 8px 16px; margin: 0 5px; border: 1px solid #ddd; background: #fff; cursor: pointer; }
            .btn:hover { background: #f0f0f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>图像流查看器</h1>
              <p>设备: <strong>${key}</strong></p>
            </div>
            
            <div class="tabs">
              <button class="tab active" onclick="switchTab('http')">HTTP 流</button>
              <button class="tab" onclick="switchTab('websocket')">WebSocket 流</button>
              <button class="tab" onclick="switchTab('mjpeg')">MJPEG 流</button>
            </div>

            <div class="metrics">
              <div class="metric">
                <div class="metric-value" id="fps">0</div>
                <div class="metric-label">FPS</div>
              </div>
              <div class="metric">
                <div class="metric-value" id="frameSize">0</div>
                <div class="metric-label">帧大小 (KB)</div>
              </div>
              <div class="metric">
                <div class="metric-value" id="resolution">-</div>
                <div class="metric-label">分辨率</div>
              </div>
              <div class="metric">
                <div class="metric-value" id="colorSpace">-</div>
                <div class="metric-label">色彩空间</div>
              </div>
            </div>

            <div id="http-content" class="content active">
              <div class="status" id="http-status">准备连接...</div>
              <div class="image-container">
                <img id="http-image" alt="HTTP 图像加载中..." style="max-width: 100%; height: auto;">
              </div>
              <div class="controls">
                <button class="btn" onclick="startHttpStream()">开始</button>
                <button class="btn" onclick="stopHttpStream()">停止</button>
              </div>
            </div>

            <div id="websocket-content" class="content">
              <div class="status" id="ws-status">准备连接...</div>
              <div class="image-container">
                <img id="ws-image" alt="WebSocket 图像加载中..." style="max-width: 100%; height: auto;">
              </div>
              <div class="controls">
                <button class="btn" onclick="startWebSocketStream()">开始</button>
                <button class="btn" onclick="stopWebSocketStream()">停止</button>
              </div>
            </div>

            <div id="mjpeg-content" class="content">
              <div class="status" id="mjpeg-status">准备连接...</div>
              <div class="image-container">
                <img id="mjpeg-image" src="/stream/${key}" alt="MJPEG 流加载中..." style="max-width: 100%; height: auto;">
              </div>
              <div class="controls">
                <button class="btn" onclick="refreshMjpegStream()">刷新</button>
              </div>
            </div>
          </div>

          <script>
            const key = "${key}";
            let httpInterval = null;
            let websocket = null;
            let frameCount = 0;
            let lastFrameTime = Date.now();
            let currentTab = 'http';

            function switchTab(tabName) {
              // 停止当前流
              stopAllStreams();
              
              // 切换标签
              document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
              document.querySelectorAll('.content').forEach(content => content.classList.remove('active'));
              
              document.querySelector(\`[onclick="switchTab('\${tabName}')"]\`).classList.add('active');
              document.getElementById(\`\${tabName}-content\`).classList.add('active');
              
              currentTab = tabName;
              resetMetrics();
            }

            function stopAllStreams() {
              if (httpInterval) {
                clearInterval(httpInterval);
                httpInterval = null;
              }
              if (websocket) {
                websocket.close();
                websocket = null;
              }
            }

            function resetMetrics() {
              document.getElementById('fps').textContent = '0';
              document.getElementById('frameSize').textContent = '0';
              document.getElementById('resolution').textContent = '-';
              document.getElementById('colorSpace').textContent = '-';
              frameCount = 0;
              lastFrameTime = Date.now();
            }

            function updateFPS() {
              frameCount++;
              const now = Date.now();
              if (now - lastFrameTime >= 1000) {
                document.getElementById('fps').textContent = frameCount;
                frameCount = 0;
                lastFrameTime = now;
              }
            }

            function updateImageMetadata(response) {
              const frameSize = response.headers.get('content-length');
              if (frameSize) {
                document.getElementById('frameSize').textContent = Math.round(parseInt(frameSize) / 1024);
              }
              
              const width = response.headers.get('X-Image-Width');
              const height = response.headers.get('X-Image-Height');
              if (width && height) {
                document.getElementById('resolution').textContent = \`\${width}×\${height}\`;
              }
              
              const colorSpace = response.headers.get('X-Image-ColorSpace');
              if (colorSpace) {
                document.getElementById('colorSpace').textContent = colorSpace;
              }
            }

            function startHttpStream() {
              stopHttpStream();
              document.getElementById('http-status').textContent = 'HTTP 流已连接';
              document.getElementById('http-status').className = 'status connected';
              
              async function fetchFrame() {
                try {
                  const response = await fetch(\`/image/\${key}?\${Date.now()}\`);
                  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
                  
                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  
                  const img = document.getElementById('http-image');
                  img.onload = () => {
                    URL.revokeObjectURL(url);
                    updateFPS();
                  };
                  img.src = url;
                  
                  updateImageMetadata(response);
                } catch (error) {
                  console.error('HTTP 流错误:', error);
                  document.getElementById('http-status').textContent = \`HTTP 流错误: \${error.message}\`;
                  document.getElementById('http-status').className = 'status error';
                }
              }
              
              httpInterval = setInterval(fetchFrame, 100);
            }

            function stopHttpStream() {
              if (httpInterval) {
                clearInterval(httpInterval);
                httpInterval = null;
                document.getElementById('http-status').textContent = 'HTTP 流已停止';
                document.getElementById('http-status').className = 'status';
              }
            }

            function startWebSocketStream() {
              stopWebSocketStream();
              
              try {
                websocket = new WebSocket('ws://localhost:9090');
                
                websocket.onopen = () => {
                  document.getElementById('ws-status').textContent = 'WebSocket 已连接';
                  document.getElementById('ws-status').className = 'status connected';
                  websocket.send(key);
                };
                
                websocket.onmessage = (event) => {
                  if (event.data instanceof Blob) {
                    const url = URL.createObjectURL(event.data);
                    const img = document.getElementById('ws-image');
                    img.onload = () => {
                      URL.revokeObjectURL(url);
                      updateFPS();
                    };
                    img.src = url;
                    
                    document.getElementById('frameSize').textContent = Math.round(event.data.size / 1024);
                    
                    // 继续请求下一帧
                    if (websocket && websocket.readyState === WebSocket.OPEN) {
                      setTimeout(() => websocket.send(key), 50);
                    }
                  }
                };
                
                websocket.onerror = (error) => {
                  console.error('WebSocket 错误:', error);
                  document.getElementById('ws-status').textContent = 'WebSocket 连接错误';
                  document.getElementById('ws-status').className = 'status error';
                };
                
                websocket.onclose = () => {
                  document.getElementById('ws-status').textContent = 'WebSocket 已断开';
                  document.getElementById('ws-status').className = 'status';
                  websocket = null;
                };
              } catch (error) {
                console.error('WebSocket 启动失败:', error);
                document.getElementById('ws-status').textContent = \`WebSocket 启动失败: \${error.message}\`;
                document.getElementById('ws-status').className = 'status error';
              }
            }

            function stopWebSocketStream() {
              if (websocket) {
                websocket.close();
                websocket = null;
                document.getElementById('ws-status').textContent = 'WebSocket 已停止';
                document.getElementById('ws-status').className = 'status';
              }
            }

            function refreshMjpegStream() {
              const img = document.getElementById('mjpeg-image');
              const src = img.src;
              img.src = '';
              setTimeout(() => {
                img.src = src + '?t=' + Date.now();
                document.getElementById('mjpeg-status').textContent = 'MJPEG 流已刷新';
                document.getElementById('mjpeg-status').className = 'status connected';
              }, 100);
            }

            // MJPEG 流监控
            document.getElementById('mjpeg-image').onload = () => {
              document.getElementById('mjpeg-status').textContent = 'MJPEG 流正常';
              document.getElementById('mjpeg-status').className = 'status connected';
              updateFPS();
            };

            document.getElementById('mjpeg-image').onerror = () => {
              document.getElementById('mjpeg-status').textContent = 'MJPEG 流连接失败';
              document.getElementById('mjpeg-status').className = 'status error';
            };

            // 默认启动 HTTP 流
            startHttpStream();
          </script>
        </body>
        </html>
      `);
    });

    // MJPEG 流接口
    this.app.get("/stream/:key", (req, res) => {
      const key = req.params.key;
      const imageData = this.imageMap.get(key);
      if (!imageData) {
        res.status(404).json({ error: "Image stream not found", key });
        return;
      }

      res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=frame");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // 将此响应添加到流客户端列表
      if (!this.streamClients.has(key)) {
        this.streamClients.set(key, new Set());
      }
      this.streamClients.get(key)!.add(res);

      // 发送初始帧
      this.sendMJPEGFrame(res, imageData);

      req.on("close", () => {
        const clients = this.streamClients.get(key);
        if (clients) {
          clients.delete(res);
          if (clients.size === 0) {
            this.streamClients.delete(key);
          }
        }
        log(`MJPEG stream closed for key: ${key}`);
      });

      req.on("error", (error) => {
        log(`MJPEG stream error for key: ${key}, error: ${error.message}`);
        const clients = this.streamClients.get(key);
        if (clients) {
          clients.delete(res);
        }
      });
    });

    // 创建WebSocket服务器
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws, request) => {
      log("WebSocket connection established");
      
      ws.on("message", (message) => {
        const key = message.toString();
        const imageData = this.imageMap.get(key);
        if (imageData) {
          try {
            // 发送图像数据和时间戳
            const timestampBuffer = Buffer.from(imageData.timestamp.toString());
            const imageBuffer = Buffer.from(imageData.buffer);
            const combined = Buffer.concat([imageBuffer, Buffer.from('\n---TIMESTAMP---\n'), timestampBuffer]);
            
            if (ws.readyState === ws.OPEN) {
              ws.send(imageBuffer); // 只发送图像数据，时间戳放在HTTP头中更合适
            }
          } catch (error) {
            log(`Error sending WebSocket message: ${error}`);
          }
        } else {
          log(`WebSocket requested image not found: ${key}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ error: "Image not found", key }));
          }
        }
      });

      ws.on("error", (error) => {
        log(`WebSocket error: ${error.message}`);
      });

      ws.on("close", () => {
        log("WebSocket connection closed");
      });
    });

    // 创建HTTP服务器
    this.server = this.app.listen(port, () => {
      log(`Image service is running on port ${port}`);
      log(`- HTTP API: http://localhost:${port}`);
      log(`- WebSocket: ws://localhost:${port}`);
      log(`- View interface: http://localhost:${port}/view/:key`);
    });

    // 处理WebSocket升级请求
    this.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });
  }

  private sendMJPEGFrame(res: http.ServerResponse, imageData: ImageData): void {
    try {
      if (!res.destroyed) {
        res.write(`--frame\r\n`);
        res.write(`Content-Type: image/jpeg\r\n`);
        res.write(`Content-Length: ${imageData.buffer.byteLength}\r\n`);
        res.write(`X-Frame-Timestamp: ${imageData.timestamp}\r\n`);
        
        if (imageData.metadata) {
          if (imageData.metadata.width) res.write(`X-Image-Width: ${imageData.metadata.width}\r\n`);
          if (imageData.metadata.height) res.write(`X-Image-Height: ${imageData.metadata.height}\r\n`);
          if (imageData.metadata.colorSpace) res.write(`X-Image-ColorSpace: ${imageData.metadata.colorSpace}\r\n`);
          if (imageData.metadata.format) res.write(`X-Image-Format: ${imageData.metadata.format}\r\n`);
        }
        
        res.write(`\r\n`);
        res.write(Buffer.from(imageData.buffer));
        res.write(`\r\n`);
      }
    } catch (error) {
      log(`Error sending MJPEG frame: ${error}`);
    }
  }

  public setImage(key: string, imageData: ArrayBuffer, metadata?: {
    width?: number;
    height?: number;
    colorSpace?: string;
    format?: string;
  }): void {
    const data: ImageData = {
      buffer: imageData,
      timestamp: Date.now(),
      metadata
    };
    
    if (this.imageMap.get(key)?.buffer === imageData) {
      // log(`Image for key ${key} is unchanged, skipping update.`);
      return;
    }
    // this.imageMap.set(key, data);

    // 通知所有WebSocket客户端
    this.wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        try {
          client.send(Buffer.from(imageData));
        } catch (error) {
          log(`Error broadcasting to WebSocket client: ${error}`);
        }
      }
    });

    // 更新所有MJPEG流客户端
    const streamClients = this.streamClients.get(key);
    if (streamClients && streamClients.size > 0) {
      streamClients.forEach((res) => {
        try {
          if (!res.destroyed) {
            this.sendMJPEGFrame(res, data);
          }
        } catch (error) {
          log(`Error updating MJPEG stream: ${error}`);
          streamClients.delete(res);
        }
      });
    }
  }

  public getImageKeys(): string[] {
    return Array.from(this.imageMap.keys());
  }

  public hasImage(key: string): boolean {
    return this.imageMap.has(key);
  }

  public getImageMetadata(key: string): ImageData["metadata"] | undefined {
    return this.imageMap.get(key)?.metadata;
  }

  public dispose(): void {
    // 清理所有流客户端
    this.streamClients.forEach((clients, key) => {
      clients.forEach((res) => {
        try {
          if (!res.destroyed) {
            res.end();
          }
        } catch (error) {
          log(`Error closing stream client: ${error}`);
        }
      });
    });
    this.streamClients.clear();

    // 关闭WebSocket服务器
    this.wss.clients.forEach((client) => {
      client.close();
    });
    this.wss.close();

    // 关闭HTTP服务器
    if (this.server) {
      this.server.close();
    }

    log("Image service disposed");
  }
}
