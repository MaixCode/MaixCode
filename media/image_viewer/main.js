(function () {
  const vscode = acquireVsCodeApi();

  const deviceSelect = document.getElementById('deviceSelect');
  const connectionStatus = document.getElementById('connectionStatus');
  const streamImage = document.getElementById('streamImage');
  const imageOverlay = document.getElementById('imageOverlay');
  const overlayInfo = document.getElementById('overlayInfo');
  const logContainer = document.getElementById('logContainer');
  const fpsValue = document.getElementById('fpsValue');
  const frameSizeValue = document.getElementById('frameSizeValue');
  const resolutionValue = document.getElementById('resolutionValue');
  const latencyValue = document.getElementById('latencyValue');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const screenshotBtn = document.getElementById('screenshotBtn');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const openPanelBtn = document.getElementById('openPanelBtn');
  const intervalInput = document.getElementById('intervalInput');
  const overlayToggle = document.getElementById('overlayToggle');
  const autoReconnect = document.getElementById('autoReconnect');
  const streamModes = document.querySelectorAll('.stream-mode');

  let httpBase = '';
  let wsUrl = '';
  let currentDevice = null;
  let currentMode = 'websocket';
  let isStreaming = false;
  let streamTimer = null;
  let websocket = null;
  let httpInFlight = false;
  let httpAbort = null;
  let reconnectTimer = null;
  let objectUrl = null;
  let pendingWsMeta = null;
  let frameCount = 0;
  let lastFPSUpdate = performance.now();
  let droppedHint = 0;
  let lastPaint = 0;
  let metaThrottle = 0;
  let pendingBlob = null;
  let pendingMeta = null;
  let pendingSize = null;
  let painting = false;

  function log(message, type) {
    if (!logContainer) {
      return;
    }
    type = type || 'info';
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    entry.textContent = new Date().toLocaleTimeString() + ' ' + message;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    while (logContainer.children.length > 30) {
      logContainer.removeChild(logContainer.firstChild);
    }
  }

  function updateStatus(message, type) {
    connectionStatus.textContent = message;
    connectionStatus.className = 'status ' + (type || 'idle');
  }

  /** One decode at a time; keep only the newest pending blob. */
  function paintBlob(blob, meta, size) {
    pendingBlob = blob;
    pendingMeta = meta;
    pendingSize = size;
    if (painting) {
      return;
    }
    painting = true;
    const b = pendingBlob;
    const m = pendingMeta;
    const s = pendingSize;
    pendingBlob = null;
    pendingMeta = null;
    pendingSize = null;
    if (!b || !isStreaming) {
      painting = false;
      return;
    }
    const next = URL.createObjectURL(b);
    const prev = objectUrl;
    objectUrl = next;
    const onDone = function () {
      streamImage.removeEventListener('load', onDone);
      streamImage.removeEventListener('error', onDone);
      if (prev && prev !== objectUrl) {
        URL.revokeObjectURL(prev);
      }
      lastPaint = performance.now();
      if (m || s != null) {
        applyMeta(m, s);
      }
      painting = false;
      if (pendingBlob && isStreaming) {
        paintBlob(pendingBlob, pendingMeta, pendingSize);
      }
    };
    streamImage.addEventListener('load', onDone);
    streamImage.addEventListener('error', onDone);
    streamImage.src = next;
  }

  function revokeObjectUrl() {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        /* ignore */
      }
      objectUrl = null;
    }
  }

  function resetMetrics() {
    frameCount = 0;
    lastFPSUpdate = performance.now();
    fpsValue.textContent = '0';
    frameSizeValue.textContent = '0';
    resolutionValue.textContent = '-';
    latencyValue.textContent = '-';
  }

  function bumpFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFPSUpdate >= 1000) {
      fpsValue.textContent = String(frameCount);
      frameCount = 0;
      lastFPSUpdate = now;
    }
  }

  function applyMeta(meta, size, force) {
    bumpFps();
    const now = performance.now();
    if (!force && now - metaThrottle < 100) {
      if (size != null) {
        frameSizeValue.textContent = String(Math.round(size / 1024));
      }
      updateOverlay();
      return;
    }
    metaThrottle = now;
    if (size != null) {
      frameSizeValue.textContent = String(Math.round(size / 1024));
    }
    if (meta) {
      if (meta.width && meta.height) {
        resolutionValue.textContent = meta.width + '\u00d7' + meta.height;
      }
      if (meta.ts) {
        const ts = typeof meta.ts === 'string' ? parseInt(meta.ts, 10) : meta.ts;
        latencyValue.textContent = Math.max(0, Date.now() - ts) + 'ms';
      }
    }
    updateOverlay();
  }

  function updateOverlay() {
    if (!overlayToggle.checked) {
      imageOverlay.style.display = 'none';
      return;
    }
    imageOverlay.style.display = 'block';
    overlayInfo.textContent =
      fpsValue.textContent +
      'fps · ' +
      frameSizeValue.textContent +
      'KB · ' +
      latencyValue.textContent +
      ' · ' +
      currentMode.toUpperCase();
  }

  function clearTimers() {
    if (streamTimer) {
      clearTimeout(streamTimer);
      streamTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeWs() {
    if (websocket) {
      try {
        websocket.onclose = null;
        websocket.onmessage = null;
        websocket.close();
      } catch (e) {
        /* ignore */
      }
      websocket = null;
    }
    pendingWsMeta = null;
  }

  function abortHttp() {
    if (httpAbort) {
      try {
        httpAbort.abort();
      } catch (e) {
        /* ignore */
      }
      httpAbort = null;
    }
    httpInFlight = false;
  }

  function stopStream(silent) {
    isStreaming = false;
    clearTimers();
    closeWs();
    abortHttp();
    pendingBlob = null;
    pendingMeta = null;
    pendingSize = null;
    painting = false;
    streamImage.removeAttribute('src');
    revokeObjectUrl();
    startBtn.disabled = !currentDevice;
    stopBtn.disabled = true;
    screenshotBtn.disabled = true;
    if (!silent) {
      updateStatus('Stopped', 'idle');
      log('Stopped');
    }
  }

  function scheduleReconnect(fn) {
    if (!autoReconnect.checked || !isStreaming) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(fn, 800);
    updateStatus('Reconnecting…', 'connecting');
  }

  function startStream() {
    if (!currentDevice || !httpBase) {
      log('No device / service', 'error');
      return;
    }
    stopStream(true);
    isStreaming = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    screenshotBtn.disabled = false;
    resetMetrics();
    updateStatus('Connecting', 'connecting');
    log(currentMode.toUpperCase() + ' → ' + currentDevice);
    if (currentMode === 'http') {
      startHttpStream();
    } else if (currentMode === 'websocket') {
      startWebSocketStream();
    } else {
      startMjpegStream();
    }
  }

  function headersToMeta(response) {
    return {
      width: response.headers.get('X-Image-Width'),
      height: response.headers.get('X-Image-Height'),
      colorSpace: response.headers.get('X-Image-ColorSpace'),
      format: response.headers.get('X-Image-Format'),
      ts: response.headers.get('X-Frame-Timestamp'),
      mime: response.headers.get('Content-Type'),
    };
  }

  function httpIntervalMs() {
    return Math.max(16, parseInt(intervalInput.value, 10) || 33);
  }

  async function startHttpStream() {
    if (!isStreaming || currentMode !== 'http') {
      return;
    }
    if (httpInFlight) {
      return;
    }
    httpInFlight = true;
    const t0 = performance.now();
    const interval = httpIntervalMs();
    httpAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    try {
      const url =
        httpBase +
        '/image/' +
        encodeURIComponent(currentDevice) +
        '?t=' +
        Date.now();
      const response = await fetch(url, {
        cache: 'no-store',
        signal: httpAbort ? httpAbort.signal : undefined,
      });
      if (response.status === 404) {
        updateStatus('Waiting…', 'connecting');
      } else if (response.status === 304) {
        /* keep image */
      } else if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      } else {
        const blob = await response.blob();
        if (blob.size > 0) {
          paintBlob(blob, headersToMeta(response), blob.size);
          updateStatus('Live', 'connected');
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        httpInFlight = false;
        httpAbort = null;
        return;
      }
      log('HTTP ' + (err && err.message ? err.message : err), 'error');
      if (autoReconnect.checked && isStreaming) {
        updateStatus('Reconnecting…', 'connecting');
      } else {
        updateStatus('Error', 'error');
        stopStream(true);
        httpInFlight = false;
        httpAbort = null;
        return;
      }
    }
    httpInFlight = false;
    httpAbort = null;
    if (isStreaming && currentMode === 'http') {
      const spent = performance.now() - t0;
      const wait = Math.max(0, interval - spent);
      streamTimer = setTimeout(startHttpStream, wait);
    }
  }

  function startWebSocketStream() {
    if (!wsUrl) {
      log('No WS URL', 'error');
      stopStream();
      return;
    }
    closeWs();
    try {
      websocket = new WebSocket(wsUrl);
      websocket.binaryType = 'blob';
      websocket.onopen = function () {
        updateStatus('Live', 'connected');
        log('WS open', 'success');
        websocket.send(
          JSON.stringify({
            op: 'subscribe',
            key: currentDevice,
            mode: 'push',
          })
        );
      };
      websocket.onmessage = function (event) {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.op === 'frame') {
              pendingWsMeta = {
                width: msg.width,
                height: msg.height,
                colorSpace: msg.colorSpace,
                format: msg.format,
                ts: msg.ts,
                mime: msg.mime,
              };
              droppedHint = msg.size || 0;
            } else if (msg.op === 'error' && msg.error === 'not_found') {
              updateStatus('Waiting…', 'connecting');
            }
          } catch (e) {
            /* ignore */
          }
          return;
        }
        const blob = event.data;
        // Drop intermediate frames: only keep newest blob for paint
        paintBlob(blob, pendingWsMeta, blob.size || droppedHint);
        pendingWsMeta = null;
        updateStatus('Live', 'connected');
      };
      websocket.onerror = function () {
        updateStatus('WS error', 'error');
      };
      websocket.onclose = function () {
        websocket = null;
        if (isStreaming && currentMode === 'websocket') {
          scheduleReconnect(startWebSocketStream);
        }
      };
    } catch (err) {
      log('WS ' + err.message, 'error');
      stopStream();
    }
  }

  function startMjpegStream() {
    streamImage.onload = function () {
      updateStatus('Live', 'connected');
      bumpFps();
      updateOverlay();
    };
    streamImage.onerror = function () {
      if (isStreaming && currentMode === 'mjpeg') {
        scheduleReconnect(function () {
          if (!isStreaming || currentMode !== 'mjpeg') {
            return;
          }
          streamImage.src =
            httpBase +
            '/stream/' +
            encodeURIComponent(currentDevice) +
            '?t=' +
            Date.now();
        });
      }
    };
    streamImage.src =
      httpBase +
      '/stream/' +
      encodeURIComponent(currentDevice) +
      '?t=' +
      Date.now();
    updateStatus('Connecting', 'connecting');
    pollMjpegMeta();
  }

  async function pollMjpegMeta() {
    if (!isStreaming || currentMode !== 'mjpeg' || !currentDevice) {
      return;
    }
    try {
      const res = await fetch(
        httpBase + '/image/' + encodeURIComponent(currentDevice),
        { method: 'HEAD', cache: 'no-store' }
      );
      if (res.ok) {
        applyMeta(headersToMeta(res), null, true);
      }
    } catch (e) {
      /* ignore */
    }
    if (isStreaming && currentMode === 'mjpeg') {
      streamTimer = setTimeout(pollMjpegMeta, 500);
    }
  }

  function switchStreamMode(mode) {
    if (mode === currentMode) {
      return;
    }
    const was = isStreaming;
    stopStream(true);
    currentMode = mode;
    streamModes.forEach(function (m) {
      m.classList.toggle('active', m.dataset.mode === mode);
    });
    vscode.postMessage({ type: 'modeChanged', mode: mode });
    if (was && currentDevice) {
      startStream();
    }
  }

  function onDeviceChange() {
    const key = deviceSelect.value;
    if (!key || key === currentDevice) {
      return;
    }
    stopStream(true);
    currentDevice = key;
    updateStatus('Selected', 'idle');
    startBtn.disabled = false;
    vscode.postMessage({ type: 'deviceSelected', key: key });
  }

  function takeScreenshot() {
    try {
      const w = streamImage.naturalWidth || streamImage.width;
      const h = streamImage.naturalHeight || streamImage.height;
      if (!w || !h) {
        vscode.postMessage({ type: 'screenshot', key: currentDevice });
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(streamImage, 0, 0);
      vscode.postMessage({
        type: 'screenshotData',
        key: currentDevice,
        dataUrl: canvas.toDataURL('image/png'),
      });
    } catch (err) {
      vscode.postMessage({ type: 'screenshot', key: currentDevice });
    }
  }

  function fillDevices(devices, preferredKey) {
    const prev = preferredKey || currentDevice || deviceSelect.value;
    deviceSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.textContent = devices.length ? 'Device' : 'No device';
    if (!devices.length) {
      placeholder.selected = true;
    }
    deviceSelect.appendChild(placeholder);
    devices.forEach(function (d) {
      const opt = document.createElement('option');
      opt.value = d.key;
      opt.textContent = d.name + (d.ip ? ' (' + d.ip + ')' : '');
      deviceSelect.appendChild(opt);
    });
    if (
      prev &&
      Array.prototype.some.call(deviceSelect.options, function (o) {
        return o.value === prev;
      })
    ) {
      deviceSelect.value = prev;
      currentDevice = prev;
      startBtn.disabled = false;
    } else if (devices.length === 1) {
      deviceSelect.value = devices[0].key;
      currentDevice = devices[0].key;
      startBtn.disabled = false;
    } else if (prev && currentDevice === prev) {
      stopStream();
      currentDevice = null;
      updateStatus('Disconnected', 'error');
    }
  }

  deviceSelect.addEventListener('change', onDeviceChange);
  startBtn.addEventListener('click', startStream);
  stopBtn.addEventListener('click', function () {
    stopStream();
  });
  screenshotBtn.addEventListener('click', takeScreenshot);
  if (openSidebarBtn) {
    openSidebarBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openSidebar' });
    });
  }
  if (openPanelBtn) {
    openPanelBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openPanel' });
    });
  }
  overlayToggle.addEventListener('change', updateOverlay);
  streamModes.forEach(function (mode) {
    mode.addEventListener('click', function () {
      switchStreamMode(mode.dataset.mode);
    });
  });

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || !message.type) {
      return;
    }
    if (message.type === 'init') {
      httpBase = message.httpBase || '';
      wsUrl = message.wsUrl || '';
      currentMode = message.defaultMode || 'websocket';
      if (currentMode !== 'http' && currentMode !== 'mjpeg') {
        currentMode = 'websocket';
      }
      streamModes.forEach(function (m) {
        m.classList.toggle('active', m.dataset.mode === currentMode);
      });
      if (message.httpInterval) {
        intervalInput.value = String(message.httpInterval);
      }
      fillDevices(message.devices || []);
      log(httpBase || 'no service');
      if (message.autoStart && currentDevice) {
        startStream();
      }
    } else if (message.type === 'updateDeviceList') {
      fillDevices(message.devices || []);
    } else if (message.type === 'serviceEndpoints') {
      httpBase = message.httpBase || httpBase;
      wsUrl = message.wsUrl || wsUrl;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
