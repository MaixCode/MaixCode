import * as vscode from "vscode";
import path from "path";
import { ImageType } from "../../model/image_type";
import { Instance } from "../../instance";
import { DeviceService } from "../../service/device_service";
import { log } from "../../logger";
import { ImageService } from "../../service/image_service";

export class ImageViewer {
  private imagePanel: vscode.WebviewPanel | undefined;
  private imageType: ImageType = ImageType.JPEG;
  private refreshInterval: NodeJS.Timeout | undefined;
  private readonly serverUrl: string = "http://localhost:9090";
  private imageService: ImageService;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.imageService = Instance.instance.imageService;

    context.subscriptions.push(
      vscode.commands.registerCommand("maixcode.openImageViewer", () => {
        this.showWindow();
      })
    );
  }

  public async showWindow(): Promise<void> {
    if (!this.imagePanel) {
      this.imagePanel = vscode.window.createWebviewPanel(
        "imagePreview",
        "Real-time Image Preview",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [this.context.extensionUri],
          retainContextWhenHidden: true,
        }
      );

      this.imagePanel.onDidDispose(() => {
        this.imagePanel = undefined;
        if (this.refreshInterval) {
          clearInterval(this.refreshInterval);
          this.refreshInterval = undefined;
        }
      });

      this.imagePanel.webview.onDidReceiveMessage((message) => {
        if (message.type === "deviceSelected") {
          this.startFetchingImages(message.key);
        } else if (message.type === "logError") {
          log(`Image viewer error: ${message.error}`);
        }
      });

      this.startDeviceListRefresh();
    }

    this.imagePanel.webview.html = await this.getWebviewContent();
  }

  private async getWebviewContent(): Promise<string> {
    const devices = Instance.instance.deviceManager.getConnectedDevice();
    const deviceOptions = devices.map(
      (device) =>
        `<option value="${device.device?.name || "Unknown"}">${
          device.device?.name || "Unknown"
        } (${device.device?.ip})</option>`
    );

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Real-time Image Viewer</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 10px; }
          .container { display: flex; flex-direction: column; gap: 10px; }
          .controls { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
          img { max-width: 100%; height: auto; border: 1px solid #ccc; background: #f0f0f0; }
          select { padding: 5px; min-width: 200px; }
          #status { margin-left: 10px; font-style: italic; }
          .debug-info { font-size: 12px; color: #666; margin-top: 5px; }
          .view-options { display: flex; gap: 10px; margin-bottom: 10px; }
          .view-option { cursor: pointer; padding: 5px 10px; border: 1px solid #ccc; border-radius: 3px; }
          .view-option.active { background-color: #007acc; color: white; }
          .metrics { display: flex; gap: 20px; margin-top: 5px; font-size: 12px; }
          .metric { color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>MaixCAM 实时图像预览</h2>
          <div class="controls">
            <label for="deviceSelect">设备: </label>
            <select id="deviceSelect">
              <option value="" disabled selected>选择设备</option>
              ${deviceOptions.join("")}
            </select>
            <span id="status">未选择设备</span>
          </div>
          <div class="view-options">
            <div class="view-option active" data-mode="http">HTTP</div>
            <div class="view-option" data-mode="websocket">WebSocket</div>
          </div>
          <div>
            <img id="image" alt="等待选择设备..." width="640" height="480">
            <div class="metrics">
              <div class="metric">帧率: <span id="fps">0</span> FPS</div>
              <div class="metric">大小: <span id="frameSize">0</span> KB</div>
              <div class="metric" id="debug-info">未连接</div>
            </div>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          const deviceSelect = document.getElementById('deviceSelect');
          const imageElement = document.getElementById('image');
          const statusElement = document.getElementById('status');
          const debugInfo = document.getElementById('debug-info');
          const fpsElement = document.getElementById('fps');
          const frameSizeElement = document.getElementById('frameSize');
          const viewOptions = document.querySelectorAll('.view-option');
          
          const fetchInterval = 100;
          const serverUrl = '${this.serverUrl}';
          let currentKey = null;
          let imageUpdateTimer = null;
          let errorCount = 0;
          let frameCount = 0;
          let lastFrameTime = performance.now();
          let currentMode = 'http';
          let websocket = null;
          
          // View mode selector
          viewOptions.forEach(option => {
            option.addEventListener('click', () => {
              const mode = option.dataset.mode;
              if (mode === currentMode) return;
              
              // Update active state
              viewOptions.forEach(opt => opt.classList.remove('active'));
              option.classList.add('active');
              
              // Clean up current mode
              if (currentMode === 'http' && imageUpdateTimer) {
                clearTimeout(imageUpdateTimer);
                imageUpdateTimer = null;
              } else if (currentMode === 'websocket' && websocket) {
                websocket.close();
                websocket = null;
              }
              
              // Set new mode
              currentMode = mode;
              
              // Start appropriate fetching method if we have a device selected
              if (currentKey) {
                if (mode === 'http') {
                  fetchImage(currentKey);
                } else if (mode === 'websocket') {
                  connectWebSocket(currentKey);
                }
              }
            });
          });

          deviceSelect.addEventListener('change', () => {
            const selectedKey = deviceSelect.value;
            
            // Clear previous fetching method
            if (imageUpdateTimer) {
              clearTimeout(imageUpdateTimer);
              imageUpdateTimer = null;
            }
            
            if (websocket) {
              websocket.close();
              websocket = null;
            }

            if (selectedKey) {
              currentKey = selectedKey;
              statusElement.textContent = "已连接: " + selectedKey;
              vscode.postMessage({ type: 'deviceSelected', key: selectedKey });
              errorCount = 0;
              frameCount = 0;
              lastFrameTime = performance.now();
              
              // Start fetching based on current mode
              if (currentMode === 'http') {
                fetchImage(selectedKey);
              } else if (currentMode === 'websocket') {
                connectWebSocket(selectedKey);
              }
            } else {
              statusElement.textContent = "未选择设备";
              imageElement.alt = "等待选择设备...";
              debugInfo.textContent = "未连接";
              currentKey = null;
            }
          });

          window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'updateDeviceList') {
              const devices = message.devices;
              const currentSelection = deviceSelect.value;
              
              deviceSelect.innerHTML = '<option value="" disabled>选择设备</option>';
              
              devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.name;
                option.textContent = device.name + ' (' + device.ip + ')';
                deviceSelect.appendChild(option);
              });
              
              if (currentSelection) {
                const exists = Array.from(deviceSelect.options).some(opt => opt.value === currentSelection);
                if (exists) {
                  deviceSelect.value = currentSelection;
                } else {
                  statusElement.textContent = "设备连接已断开";
                  debugInfo.textContent = "连接已断开";
                  
                  // Clean up based on current mode
                  if (currentMode === 'http' && imageUpdateTimer) {
                    clearTimeout(imageUpdateTimer);
                    imageUpdateTimer = null;
                  } else if (currentMode === 'websocket' && websocket) {
                    websocket.close();
                    websocket = null;
                  }
                }
              }
            }
          });
          
          function updateFPS() {
            const now = performance.now();
            frameCount++;
            if (now - lastFrameTime >= 1000) {
              fpsElement.textContent = frameCount.toString();
              frameCount = 0;
              lastFrameTime = now;
            }
          }

          async function fetchImage(key) {
            if (!key) return;
            
            try {
              const url = \`\${serverUrl}/image/\${key}\`;
              const timestamp = Date.now();
              const response = await fetch(\`\${url}?\${timestamp}\`);
              
              if (!response.ok) {
                throw new Error(\`请求失败: \${response.status} \${response.statusText}\`);
              }
              
              const blob = await response.blob();
              if (blob.size === 0) {
                throw new Error('接收到空图像数据');
              }
              
              const imageUrl = URL.createObjectURL(blob);
              imageElement.src = imageUrl;
              imageElement.onload = () => URL.revokeObjectURL(imageUrl);
              
              frameSizeElement.textContent = (blob.size/1024).toFixed(1);
              debugInfo.textContent = \`时间: \${new Date().toLocaleTimeString()}\`;
              updateFPS();
              errorCount = 0;
            } catch (error) {
              errorCount++;
              console.error('Error fetching image:', error);
              
              if (errorCount <= 3) {
                debugInfo.textContent = \`错误: \${error.message} | 重试中...\`;
              } else if (errorCount === 5) {
                imageElement.alt = \`图像加载失败: \${error.message}\`;
                vscode.postMessage({ 
                  type: 'logError', 
                  error: \`Image fetch error: \${error.message}\` 
                });
              }
            } finally {
              if (currentKey && currentMode === 'http') {
                imageUpdateTimer = setTimeout(() => fetchImage(currentKey), fetchInterval);
              }
            }
          }
          
          function connectWebSocket(key) {
            if (!key) return;
            
            try {
              const wsUrl = \`ws://localhost:9090\`;
              websocket = new WebSocket(wsUrl);
              
              websocket.onopen = () => {
                debugInfo.textContent = "WebSocket 已连接";
                // Start sending the key to request images
                websocket.send(key);
              };
              
              websocket.onmessage = (event) => {
                if (event.data instanceof Blob) {
                  const blob = event.data;
                  const imageUrl = URL.createObjectURL(blob);
                  imageElement.src = imageUrl;
                  imageElement.onload = () => URL.revokeObjectURL(imageUrl);
                  
                  frameSizeElement.textContent = (blob.size/1024).toFixed(1);
                  updateFPS();
                  
                  // Request next frame
                  if (websocket.readyState === WebSocket.OPEN) {
                    websocket.send(key);
                  }
                }
              };
              
              websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                debugInfo.textContent = "WebSocket 错误";
                vscode.postMessage({ 
                  type: 'logError', 
                  error: 'WebSocket connection error' 
                });
              };
              
              websocket.onclose = () => {
                debugInfo.textContent = "WebSocket 已关闭";
                websocket = null;
              };
            } catch (error) {
              console.error('Failed to connect WebSocket:', error);
              debugInfo.textContent = \`WebSocket 连接失败: \${error.message}\`;
              vscode.postMessage({ 
                type: 'logError', 
                error: \`WebSocket connection failed: \${error.message}\` 
              });
              
              // Fallback to HTTP
              if (currentMode === 'websocket') {
                currentMode = 'http';
                viewOptions.forEach(opt => {
                  if (opt.dataset.mode === 'http') {
                    opt.classList.add('active');
                  } else {
                    opt.classList.remove('active');
                  }
                });
                fetchImage(key);
              }
            }
          }
        </script>
      </body>
      </html>
    `;
  }

  private startFetchingImages(key: string): void {
    if (this.imagePanel) {
      this.imagePanel.webview.postMessage({ type: "start", key });
    }
  }

  private startDeviceListRefresh(): void {
    this.refreshInterval = setInterval(() => {
      this.updateDeviceList();
    }, 2000);
  }

  private updateDeviceList(): void {
    if (!this.imagePanel) return;

    const devices = Instance.instance.deviceManager.getConnectedDevice();
    const deviceList = devices.map((device) => ({
      name: device.device?.name || "Unknown",
      ip: device.device?.ip || "",
    }));

    this.imagePanel.webview.postMessage({
      type: "updateDeviceList",
      devices: deviceList,
    });
  }
}
