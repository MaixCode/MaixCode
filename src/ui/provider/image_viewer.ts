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
  // private imageService: ImageService;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private imageService: ImageService
  ) {
    // this.imageService = Instance.instance.imageService;

    // context.subscriptions.push(
    //   vscode.commands.registerCommand("maixcode.openImageViewer", () => {
    //     this.showWindow();
    //   })
    // );
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
      <html lang="zh-cn">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MaixCAM 图像流查看器</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: #1e1e1e; 
            color: #cccccc; 
            padding: 20px;
            line-height: 1.4;
          }
          
          .header { 
            background: #2d2d30; 
            padding: 20px; 
            border-radius: 8px; 
            margin-bottom: 20px;
            border: 1px solid #3e3e42;
          }
          
          .header h1 { 
            color: #ffffff; 
            font-size: 24px; 
            margin-bottom: 10px; 
          }
          
          .device-selector {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-top: 15px;
          }
          
          .device-selector label { 
            color: #cccccc; 
            font-weight: 500; 
          }
          
          .device-selector select { 
            padding: 8px 12px; 
            border: 1px solid #3e3e42; 
            background: #383838; 
            color: #cccccc; 
            border-radius: 4px; 
            min-width: 250px;
          }
          
          .status { 
            padding: 8px 16px; 
            border-radius: 4px; 
            font-weight: 500; 
            font-size: 14px;
          }
          
          .status.connected { 
            background: #0e4429; 
            color: #26d450; 
            border: 1px solid #26d450; 
          }
          
          .status.error { 
            background: #4b1010; 
            color: #f85149; 
            border: 1px solid #f85149; 
          }
          
          .status.idle { 
            background: #2d2d30; 
            color: #8b8b8b; 
            border: 1px solid #3e3e42; 
          }

          .main-content { 
            display: grid; 
            grid-template-columns: 1fr 350px; 
            gap: 20px; 
            height: calc(100vh - 200px); 
          }

          .image-panel { 
            background: #2d2d30; 
            border: 1px solid #3e3e42; 
            border-radius: 8px; 
            overflow: hidden; 
            display: flex; 
            flex-direction: column; 
          }

          .image-panel-header { 
            padding: 15px; 
            background: #383838; 
            border-bottom: 1px solid #3e3e42; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
          }

          .stream-modes { 
            display: flex; 
            gap: 5px; 
          }
          
          .stream-mode { 
            padding: 6px 12px; 
            border: 1px solid #3e3e42; 
            background: #2d2d30; 
            color: #cccccc; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 12px; 
            transition: all 0.2s;
          }
          
          .stream-mode.active { 
            background: #0078d4; 
            color: white; 
            border-color: #0078d4; 
          }
          
          .stream-mode:hover:not(.active) { 
            background: #383838; 
          }

          .image-container { 
            flex: 1; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            background: #252525; 
            position: relative;
            overflow: hidden;
          }

          .image-container img { 
            max-width: 100%; 
            max-height: 100%; 
            object-fit: contain; 
            display: block;
            border-radius: 4px;
          }

          .image-overlay {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-family: 'Consolas', monospace;
          }

          .control-panel { 
            background: #2d2d30; 
            border: 1px solid #3e3e42; 
            border-radius: 8px; 
            display: flex; 
            flex-direction: column; 
          }

          .panel-section { 
            padding: 20px; 
            border-bottom: 1px solid #3e3e42; 
          }
          
          .panel-section:last-child { 
            border-bottom: none; 
            flex: 1; 
          }

          .panel-section h3 { 
            color: #ffffff; 
            margin-bottom: 15px; 
            font-size: 16px; 
          }

          .metrics-grid { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 15px; 
          }

          .metric { 
            background: #383838; 
            padding: 12px; 
            border-radius: 6px; 
            border: 1px solid #3e3e42; 
            text-align: center; 
          }

          .metric-value { 
            font-size: 20px; 
            font-weight: bold; 
            color: #0078d4; 
            display: block; 
          }

          .metric-label { 
            font-size: 11px; 
            color: #8b8b8b; 
            margin-top: 4px; 
          }

          .controls { 
            display: flex; 
            flex-direction: column; 
            gap: 10px; 
          }

          .btn { 
            padding: 10px 16px; 
            border: 1px solid #3e3e42; 
            background: #383838; 
            color: #cccccc; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 13px; 
            transition: all 0.2s;
          }
          
          .btn:hover { 
            background: #404040; 
            border-color: #0078d4; 
          }
          
          .btn.primary { 
            background: #0078d4; 
            border-color: #0078d4; 
            color: white; 
          }
          
          .btn.primary:hover { 
            background: #106ebe; 
          }
          
          .btn:disabled { 
            opacity: 0.5; 
            cursor: not-allowed; 
          }

          .settings-section { 
            display: flex; 
            flex-direction: column; 
            gap: 12px; 
          }

          .setting-row { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
          }

          .setting-row label { 
            font-size: 12px; 
            color: #cccccc; 
          }

          .setting-row select, 
          .setting-row input { 
            padding: 4px 8px; 
            border: 1px solid #3e3e42; 
            background: #383838; 
            color: #cccccc; 
            border-radius: 3px; 
            width: 100px;
            font-size: 11px;
          }

          .log-section { 
            max-height: 150px; 
            overflow-y: auto; 
            font-family: 'Consolas', monospace; 
            font-size: 11px; 
            background: #252525; 
            padding: 10px; 
            border-radius: 4px; 
            border: 1px solid #3e3e42; 
          }

          .log-entry { 
            margin-bottom: 2px; 
            color: #8b8b8b; 
          }
          
          .log-entry.error { 
            color: #f85149; 
          }
          
          .log-entry.success { 
            color: #26d450; 
          }

          .image-info {
            background: #383838;
            border: 1px solid #3e3e42;
            border-radius: 4px;
            padding: 12px;
            margin-top: 10px;
          }

          .image-info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
          }

          .image-info-row:last-child {
            margin-bottom: 0;
          }

          .image-info-label {
            color: #8b8b8b;
            font-weight: 500;
          }

          .image-info-value {
            color: #cccccc;
            font-family: 'Consolas', monospace;
          }

          @media (max-width: 1200px) {
            .main-content { 
              grid-template-columns: 1fr; 
              grid-template-rows: 2fr 1fr; 
            }
            
            .control-panel {
              max-height: 400px;
              overflow-y: auto;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>MaixCAM 实时图像预览</h1>
          <div class="device-selector">
            <label for="deviceSelect">设备:</label>
            <select id="deviceSelect">
              <option value="" disabled selected>选择设备</option>
              ${deviceOptions.join("")}
            </select>
            <div class="status idle" id="connectionStatus">未选择设备</div>
          </div>
        </div>

        <div class="main-content">
          <div class="image-panel">
            <div class="image-panel-header">
              <h3>实时视频流</h3>
              <div class="stream-modes">
                <div class="stream-mode active" data-mode="http">HTTP</div>
                <div class="stream-mode" data-mode="websocket">WebSocket</div>
                <div class="stream-mode" data-mode="mjpeg">MJPEG</div>
              </div>
            </div>
            <div class="image-container">
              <img id="streamImage" alt="等待选择设备..." />
              <div class="image-overlay" id="imageOverlay" style="display: none;">
                <div id="overlayInfo">等待数据...</div>
              </div>
            </div>
          </div>

          <div class="control-panel">
            <div class="panel-section">
              <h3>实时指标</h3>
              <div class="metrics-grid">
                <div class="metric">
                  <span class="metric-value" id="fpsValue">0</span>
                  <div class="metric-label">帧率 (FPS)</div>
                </div>
                <div class="metric">
                  <span class="metric-value" id="frameSizeValue">0</span>
                  <div class="metric-label">帧大小 (KB)</div>
                </div>
                <div class="metric">
                  <span class="metric-value" id="resolutionValue">-</span>
                  <div class="metric-label">分辨率</div>
                </div>
                <div class="metric">
                  <span class="metric-value" id="colorSpaceValue">-</span>
                  <div class="metric-label">色彩空间</div>
                </div>
              </div>
              
              <div class="image-info">
                <div class="image-info-row">
                  <span class="image-info-label">格式:</span>
                  <span class="image-info-value" id="formatValue">-</span>
                </div>
                <div class="image-info-row">
                  <span class="image-info-label">时间戳:</span>
                  <span class="image-info-value" id="timestampValue">-</span>
                </div>
                <div class="image-info-row">
                  <span class="image-info-label">延迟:</span>
                  <span class="image-info-value" id="latencyValue">-</span>
                </div>
              </div>
            </div>

            <div class="panel-section">
              <h3>控制</h3>
              <div class="controls">
                <button class="btn primary" id="startBtn">开始流传输</button>
                <button class="btn" id="stopBtn" disabled>停止流传输</button>
                <button class="btn" id="screenshotBtn" disabled>截图</button>
              </div>
            </div>

            <div class="panel-section">
              <h3>设置</h3>
              <div class="settings-section">
                <div class="setting-row">
                  <label>刷新间隔 (ms):</label>
                  <input type="number" id="intervalInput" value="100" min="50" max="1000" step="50">
                </div>
                <div class="setting-row">
                  <label>显示覆盖信息:</label>
                  <select id="overlayToggle">
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
                <div class="setting-row">
                  <label>自动重连:</label>
                  <select id="autoReconnect">
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="panel-section">
              <h3>日志</h3>
              <div class="log-section" id="logContainer">
                <div class="log-entry">等待连接...</div>
              </div>
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();
          const serverUrl = '${this.serverUrl}';
          
          // DOM elements
          const deviceSelect = document.getElementById('deviceSelect');
          const connectionStatus = document.getElementById('connectionStatus');
          const streamImage = document.getElementById('streamImage');
          const imageOverlay = document.getElementById('imageOverlay');
          const overlayInfo = document.getElementById('overlayInfo');
          const logContainer = document.getElementById('logContainer');
          
          // Metric elements
          const fpsValue = document.getElementById('fpsValue');
          const frameSizeValue = document.getElementById('frameSizeValue');
          const resolutionValue = document.getElementById('resolutionValue');
          const colorSpaceValue = document.getElementById('colorSpaceValue');
          const formatValue = document.getElementById('formatValue');
          const timestampValue = document.getElementById('timestampValue');
          const latencyValue = document.getElementById('latencyValue');
          
          // Control elements
          const startBtn = document.getElementById('startBtn');
          const stopBtn = document.getElementById('stopBtn');
          const screenshotBtn = document.getElementById('screenshotBtn');
          const intervalInput = document.getElementById('intervalInput');
          const overlayToggle = document.getElementById('overlayToggle');
          const autoReconnect = document.getElementById('autoReconnect');
          
          // Stream mode elements
          const streamModes = document.querySelectorAll('.stream-mode');
          
          // State variables
          let currentDevice = null;
          let currentMode = 'http';
          let isStreaming = false;
          let streamTimer = null;
          let websocket = null;
          
          // Metrics
          let frameCount = 0;
          let lastFPSUpdate = Date.now();
          let lastFrameTime = 0;
          let totalFrames = 0;
          
          // Event listeners
          deviceSelect.addEventListener('change', onDeviceChange);
          startBtn.addEventListener('click', startStream);
          stopBtn.addEventListener('click', stopStream);
          screenshotBtn.addEventListener('click', takeScreenshot);
          overlayToggle.addEventListener('change', toggleOverlay);
          
          streamModes.forEach(mode => {
            mode.addEventListener('click', () => switchStreamMode(mode.dataset.mode));
          });
          
          function log(message, type = 'info') {
            const entry = document.createElement('div');
            entry.className = \`log-entry \${type}\`;
            entry.textContent = \`[\${new Date().toLocaleTimeString()}] \${message}\`;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;
            
            // Keep only last 50 entries
            while (logContainer.children.length > 50) {
              logContainer.removeChild(logContainer.firstChild);
            }
          }
          
          function updateStatus(message, type = 'idle') {
            connectionStatus.textContent = message;
            connectionStatus.className = \`status \${type}\`;
          }
          
          function onDeviceChange() {
            const selectedKey = deviceSelect.value;
            if (selectedKey && selectedKey !== currentDevice) {
              stopStream();
              currentDevice = selectedKey;
              updateStatus(\`已选择: \${selectedKey}\`, 'idle');
              log(\`设备已选择: \${selectedKey}\`);
              startBtn.disabled = false;
              vscode.postMessage({ type: 'deviceSelected', key: selectedKey });
            }
          }
          
          function switchStreamMode(mode) {
            if (mode === currentMode) return;
            
            const wasStreaming = isStreaming;
            if (wasStreaming) stopStream();
            
            currentMode = mode;
            streamModes.forEach(m => {
              if (m.dataset.mode === mode) {
                m.classList.add('active');
              } else {
                m.classList.remove('active');
              }
            });
            
            log(\`切换到 \${mode.toUpperCase()} 模式\`);
            
            if (wasStreaming && currentDevice) {
              setTimeout(() => startStream(), 500);
            }
          }
          
          function startStream() {
            if (!currentDevice || isStreaming) return;
            
            isStreaming = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            screenshotBtn.disabled = false;
            
            resetMetrics();
            updateStatus(\`连接中 (\${currentMode.toUpperCase()})\`, 'connecting');
            log(\`开始 \${currentMode.toUpperCase()} 流传输\`);
            
            switch (currentMode) {
              case 'http':
                startHttpStream();
                break;
              case 'websocket':
                startWebSocketStream();
                break;
              case 'mjpeg':
                startMJPEGStream();
                break;
            }
          }
          
          function stopStream() {
            if (!isStreaming) return;
            
            isStreaming = false;
            startBtn.disabled = false;
            stopBtn.disabled = true;
            screenshotBtn.disabled = true;
            
            if (streamTimer) {
              clearTimeout(streamTimer);
              streamTimer = null;
            }
            
            if (websocket) {
              websocket.close();
              websocket = null;
            }
            
            updateStatus(\`已停止\`, 'idle');
            log('流传输已停止');
          }
          
          function resetMetrics() {
            frameCount = 0;
            lastFPSUpdate = Date.now();
            totalFrames = 0;
            fpsValue.textContent = '0';
            frameSizeValue.textContent = '0';
            resolutionValue.textContent = '-';
            colorSpaceValue.textContent = '-';
            formatValue.textContent = '-';
            timestampValue.textContent = '-';
            latencyValue.textContent = '-';
          }
          
          function updateMetrics(response, frameSize) {
            frameCount++;
            totalFrames++;
            
            const now = Date.now();
            if (now - lastFPSUpdate >= 1000) {
              fpsValue.textContent = frameCount.toString();
              frameCount = 0;
              lastFPSUpdate = now;
            }
            
            if (frameSize !== undefined) {
              frameSizeValue.textContent = Math.round(frameSize / 1024);
            }
            
            if (response && response.headers) {
              const width = response.headers.get('X-Image-Width');
              const height = response.headers.get('X-Image-Height');
              if (width && height) {
                resolutionValue.textContent = \`\${width}×\${height}\`;
              }
              
              const colorSpace = response.headers.get('X-Image-ColorSpace');
              if (colorSpace) {
                colorSpaceValue.textContent = colorSpace;
              }
              
              const format = response.headers.get('X-Image-Format');
              if (format) {
                formatValue.textContent = format;
              } else {
                formatValue.textContent = 'JPEG';
              }
              
              const timestamp = response.headers.get('X-Frame-Timestamp');
              if (timestamp) {
                timestampValue.textContent = new Date(parseInt(timestamp)).toLocaleTimeString();
                const latency = now - parseInt(timestamp);
                latencyValue.textContent = \`\${latency}ms\`;
              }
            }
            
            updateOverlay();
          }
          
          function updateOverlay() {
            if (overlayToggle.value === 'true') {
              imageOverlay.style.display = 'block';
              overlayInfo.innerHTML = \`
                FPS: \${fpsValue.textContent} | 
                Size: \${frameSizeValue.textContent}KB | 
                Mode: \${currentMode.toUpperCase()}
              \`;
            } else {
              imageOverlay.style.display = 'none';
            }
          }
          
          function toggleOverlay() {
            updateOverlay();
          }
          
          async function startHttpStream() {
            if (!isStreaming || !currentDevice) return;
            
            try {
              const response = await fetch(\`\${serverUrl}/image/\${currentDevice}?\${Date.now()}\`);
              if (!response.ok) {
                throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
              }
              
              const blob = await response.blob();
              if (blob.size === 0) {
                throw new Error('收到空图像数据');
              }
              
              const imageUrl = URL.createObjectURL(blob);
              streamImage.onload = () => {
                URL.revokeObjectURL(imageUrl);
                updateStatus(\`已连接 (HTTP)\`, 'connected');
              };
              streamImage.src = imageUrl;
              
              updateMetrics(response, blob.size);
              
            } catch (error) {
              log(\`HTTP 流错误: \${error.message}\`, 'error');
              if (autoReconnect.value === 'true' && isStreaming) {
                updateStatus('重连中...', 'connecting');
              } else {
                updateStatus('连接失败', 'error');
                stopStream();
                return;
              }
            }
            
            if (isStreaming) {
              streamTimer = setTimeout(startHttpStream, parseInt(intervalInput.value));
            }
          }
          
          function startWebSocketStream() {
            try {
              websocket = new WebSocket(\`ws://localhost:9090\`);
              
              websocket.onopen = () => {
                updateStatus('已连接 (WebSocket)', 'connected');
                log('WebSocket 连接成功', 'success');
                websocket.send(currentDevice);
              };
              
              websocket.onmessage = (event) => {
                if (event.data instanceof Blob) {
                  const imageUrl = URL.createObjectURL(event.data);
                  streamImage.onload = () => URL.revokeObjectURL(imageUrl);
                  streamImage.src = imageUrl;
                  
                  updateMetrics(null, event.data.size);
                  
                  // 请求下一帧
                  if (websocket && websocket.readyState === WebSocket.OPEN) {
                    setTimeout(() => websocket.send(currentDevice), parseInt(intervalInput.value));
                  }
                }
              };
              
              websocket.onerror = (error) => {
                log('WebSocket 错误', 'error');
                updateStatus('连接错误', 'error');
              };
              
              websocket.onclose = () => {
                log('WebSocket 连接已关闭');
                if (isStreaming && autoReconnect.value === 'true') {
                  setTimeout(startWebSocketStream, 2000);
                }
              };
              
            } catch (error) {
              log(\`WebSocket 启动失败: \${error.message}\`, 'error');
              updateStatus('连接失败', 'error');
              stopStream();
            }
          }
          
          function startMJPEGStream() {
            try {
              streamImage.src = \`\${serverUrl}/stream/\${currentDevice}?\${Date.now()}\`;
              streamImage.onload = () => {
                updateStatus('已连接 (MJPEG)', 'connected');
                log('MJPEG 流连接成功', 'success');
                updateMetrics();
              };
              streamImage.onerror = () => {
                log('MJPEG 流连接失败', 'error');
                updateStatus('连接失败', 'error');
                if (autoReconnect.value === 'true' && isStreaming) {
                  setTimeout(startMJPEGStream, 2000);
                }
              };
            } catch (error) {
              log(\`MJPEG 流启动失败: \${error.message}\`, 'error');
              updateStatus('连接失败', 'error');
              stopStream();
            }
          }
          
          function takeScreenshot() {
            if (!streamImage.src) return;
            
            try {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              canvas.width = streamImage.naturalWidth || streamImage.width;
              canvas.height = streamImage.naturalHeight || streamImage.height;
              ctx.drawImage(streamImage, 0, 0);
              
              const link = document.createElement('a');
              link.download = \`maixcam-screenshot-\${currentDevice}-\${Date.now()}.png\`;
              link.href = canvas.toDataURL();
              link.click();
              
              log('截图已保存', 'success');
            } catch (error) {
              log(\`截图失败: \${error.message}\`, 'error');
            }
          }
          
          // Handle messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'updateDeviceList') {
              const devices = message.devices;
              const currentSelection = deviceSelect.value;
              
              deviceSelect.innerHTML = '<option value="" disabled>选择设备</option>';
              
              devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.name;
                option.textContent = \`\${device.name} (\${device.ip})\`;
                deviceSelect.appendChild(option);
              });
              
              if (currentSelection) {
                const exists = Array.from(deviceSelect.options).some(opt => opt.value === currentSelection);
                if (exists) {
                  deviceSelect.value = currentSelection;
                } else {
                  log(\`设备 \${currentSelection} 已断开连接\`, 'error');
                  stopStream();
                  currentDevice = null;
                  updateStatus('设备已断开', 'error');
                }
              }
            }
          });
          
          // Initialize overlay toggle
          toggleOverlay();
          
          log('图像查看器已初始化');
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
    if (!this.imagePanel) {
      return;
    }

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
