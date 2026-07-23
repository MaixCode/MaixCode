(function () {
  const vscode = acquireVsCodeApi();

  const deviceSelect = document.getElementById('deviceSelect');
  const connectionStatus = document.getElementById('connectionStatus');
  const stage = document.getElementById('stage');
  const streamImage = document.getElementById('streamImage');
  const imageOverlay = document.getElementById('imageOverlay');
  const overlayInfo = document.getElementById('overlayInfo');
  const zoomBadge = document.getElementById('zoomBadge');
  const logContainer = document.getElementById('logContainer');
  const logPanel = document.getElementById('logPanel');
  const logBtn = document.getElementById('logBtn');
  const logClose = document.getElementById('logClose');
  const logClearBtn = document.getElementById('logClearBtn');
  // stream metrics for HUD overlay
  let metricFps = '0';
  let metricKb = '0';
  let metricRes = '-';
  let metricLatency = '-';
  const streamBtn = document.getElementById('streamBtn');
  const screenshotBtn = document.getElementById('screenshotBtn');
  const fitViewBtn = document.getElementById('fitViewBtn');
  const streamBtnStartLabel =
    (streamBtn && streamBtn.getAttribute('data-start')) || 'Start';
  const streamBtnStopLabel =
    (streamBtn && streamBtn.getAttribute('data-stop')) || 'Stop';
  const ICON_PLAY =
    '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 2.5v11l9-5.5L4 2.5z"/></svg>';
  const ICON_STOP =
    '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 3.5h9v9h-9z"/></svg>';
  const intervalInput = document.getElementById('intervalInput');
  const overlayToggle = document.getElementById('overlayToggle');
  const histogramToggle = document.getElementById('histogramToggle');
  const histSpace = document.getElementById('histSpace');
  const histPanel = document.getElementById('histPanel');
  const histResize = document.getElementById('histResize');
  const histCharts = document.getElementById('histCharts');
  const histMeta = document.getElementById('histMeta');
  const histTooltip = document.getElementById('histTooltip');
  const autoReconnect = document.getElementById('autoReconnect');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsClose = document.getElementById('settingsClose');
  const histQuality = document.getElementById('histQuality');
  const histIntervalInput = document.getElementById('histIntervalMs');
  const streamModes = document.querySelectorAll('.stream-mode');

  let httpBase = '';
  let wsUrl = '';
  let currentDevice = null;
  let currentMode = 'websocket';
  let isStreaming = false;
  /** True while auto-start / start is in progress (keeps Start/Stop UI consistent). */
  let streamStarting = false;
  /** Prefer auto-start stream whenever a device is available (from host init / setting). */
  let preferAutoStart = true;
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
  // view transform: scale + translate (css px, relative to stage center)
  let viewScale = 1;
  let viewX = 0;
  let viewY = 0;
  let panActive = false;
  let panPointerId = null;
  let panLastX = 0;
  let panLastY = 0;
  let panMoved = false;
  let zoomBadgeTimer = null;
  const VIEW_MIN = 0.1;
  const VIEW_MAX = 20;
  let histThrottle = 0;
  let histBusy = false;
  let histPending = false;
  let histSampleCanvas = null;
  let histSampleCtx = null;
  let histState = null; // { space, bins, samplePixels, sampleW, sampleH }
  let histViews = []; // per-channel canvas views
  let histHover = null; // { ch, bin }
  const HIST_BINS = 256;
  /** Longest edge for hist sample; 0 = full resolution. */
  let histMaxEdge = 320;
  let histMinMs = 120;
  let HIST_CSS_H = 80;
  const HIST_DOCK_DEFAULT_H = 500;
  const HIST_DOCK_MIN_H = 140;
  let histDockHeight = HIST_DOCK_DEFAULT_H;
  const VIEWER_SETTINGS_KEY = 'maixcode.imageViewer.settings';
  let histResizeActive = false;
  let histResizeStartY = 0;
  let histResizeStartH = 0;
  const HIST_SPACES = {
    rgb: {
      name: 'RGB',
      labels: ['R', 'G', 'B'],
      fullNames: ['Red', 'Green', 'Blue'],
      colors: ['#f85149', '#3fb950', '#58a6ff'],
      units: ['0–255', '0–255', '0–255'],
      describe: function (ch, bin) {
        return 'Channel value ' + bin;
      },
    },
    gray: {
      name: 'GRAY',
      labels: ['Y'],
      fullNames: ['Luma (BT.601)'],
      colors: ['#d0d0d0'],
      units: ['0–255'],
      describe: function (ch, bin) {
        return 'Luma Y = 0.299R+0.587G+0.114B → ' + bin;
      },
    },
    lab: {
      name: 'LAB',
      labels: ['L*', 'a*', 'b*'],
      fullNames: ['Lightness L*', 'a* (green–red)', 'b* (blue–yellow)'],
      colors: ['#e6e6e6', '#ff7b72', '#79c0ff'],
      units: ['0–100', '≈ −128…+127', '≈ −128…+127'],
      describe: function (ch, bin) {
        if (ch === 0) {
          return 'L* ≈ ' + ((bin / 255) * 100).toFixed(1) + ' (bin ' + bin + ')';
        }
        return this.labels[ch] + ' ≈ ' + (bin - 128) + ' (bin ' + bin + ')';
      },
    },
    yuv: {
      name: 'YUV',
      labels: ['Y', 'U', 'V'],
      fullNames: ['Luma Y', 'Chroma U', 'Chroma V'],
      colors: ['#d0d0d0', '#56d4dd', '#d2a8ff'],
      units: ['0–255', '0–255 (128 neutral)', '0–255 (128 neutral)'],
      describe: function (ch, bin) {
        if (ch === 0) {
          return 'Y ≈ ' + bin;
        }
        return this.labels[ch] + ' ≈ ' + bin + ' (Δ ' + (bin - 128) + ')';
      },
    },
    hsv: {
      name: 'HSV',
      labels: ['H', 'S', 'V'],
      fullNames: ['Hue', 'Saturation', 'Value'],
      colors: ['#ff9b4a', '#3fb950', '#c9d1d9'],
      units: ['0–360°', '0–100%', '0–100%'],
      describe: function (ch, bin) {
        if (ch === 0) {
          return 'Hue ≈ ' + ((bin / 255) * 360).toFixed(1) + '° (bin ' + bin + ')';
        }
        return this.labels[ch] + ' ≈ ' + ((bin / 255) * 100).toFixed(1) + '% (bin ' + bin + ')';
      },
    },
  };

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

  /** Keep at least minKeep px of the image inside the stage (never fully out of view). */
  function clampViewTranslation() {
    if (!stage || !streamImage) {
      return;
    }
    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const imgW0 = streamImage.offsetWidth;
    const imgH0 = streamImage.offsetHeight;
    if (stageW <= 0 || stageH <= 0 || imgW0 <= 0 || imgH0 <= 0) {
      return;
    }
    const scaledW = imgW0 * viewScale;
    const scaledH = imgH0 * viewScale;
    // keep a visible strip so the image cannot leave completely
    const minKeep = Math.max(
      24,
      Math.min(48, Math.min(scaledW, scaledH, stageW, stageH) * 0.2)
    );
    // center-origin coords: image AABB = [viewX ± scaledW/2, viewY ± scaledH/2]
    // stage AABB = [±stageW/2, ±stageH/2]
    // require overlap of at least minKeep on each axis when possible
    let maxX = (stageW + scaledW) / 2 - minKeep;
    let maxY = (stageH + scaledH) / 2 - minKeep;
    if (maxX < 0) {
      maxX = 0;
    }
    if (maxY < 0) {
      maxY = 0;
    }
    if (viewX > maxX) {
      viewX = maxX;
    } else if (viewX < -maxX) {
      viewX = -maxX;
    }
    if (viewY > maxY) {
      viewY = maxY;
    } else if (viewY < -maxY) {
      viewY = -maxY;
    }
  }

  function applyViewTransform() {
    if (!streamImage) {
      return;
    }
    clampViewTranslation();
    streamImage.style.transform =
      'translate(' + viewX + 'px, ' + viewY + 'px) scale(' + viewScale + ')';
    if (zoomBadge) {
      if (Math.abs(viewScale - 1) < 0.001 && Math.abs(viewX) < 0.5 && Math.abs(viewY) < 0.5) {
        zoomBadge.hidden = true;
      } else {
        zoomBadge.hidden = false;
        zoomBadge.textContent = Math.round(viewScale * 100) + '%';
      }
    }
    if (typeof overlayToggle !== 'undefined' && overlayToggle && overlayToggle.checked) {
      updateOverlay();
    }
  }

  function resetView(silent) {
    viewScale = 1;
    viewX = 0;
    viewY = 0;
    applyViewTransform();
    if (!silent) {
      /* no log spam */
    }
  }

  function clampViewScale(s) {
    return Math.max(VIEW_MIN, Math.min(VIEW_MAX, s));
  }

  /** Zoom around a point in stage client coords. */
  function zoomAt(clientX, clientY, factor) {
    if (!stage) {
      return;
    }
    const rect = stage.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const next = clampViewScale(viewScale * factor);
    if (next === viewScale) {
      // still re-clamp in case layout changed
      applyViewTransform();
      return;
    }
    // keep the content under cursor stable:
    // content point p = (cx - viewX) / viewScale
    // after: viewX' = cx - p * next
    const pX = (cx - viewX) / viewScale;
    const pY = (cy - viewY) / viewScale;
    viewX = cx - pX * next;
    viewY = cy - pY * next;
    viewScale = next;
    applyViewTransform();
  }

  function onStageWheel(ev) {
    if (!stage) {
      return;
    }
    // always prevent page/webview scroll when over image stage
    ev.preventDefault();
    const delta = ev.deltaY;
    // trackpad: small deltas; mouse wheel: larger. Use exponential zoom.
    let factor;
    if (ev.ctrlKey) {
      // some systems send ctrl+wheel as pinch
      factor = Math.exp(-delta * 0.01);
    } else {
      factor = Math.exp(-delta * 0.0025);
    }
    // normalize extreme steps
    if (factor > 1.35) {
      factor = 1.35;
    }
    if (factor < 1 / 1.35) {
      factor = 1 / 1.35;
    }
    zoomAt(ev.clientX, ev.clientY, factor);
  }

  function onStagePointerDown(ev) {
    if (!stage) {
      return;
    }
    // only primary button / touch
    if (ev.pointerType === 'mouse' && ev.button !== 0) {
      return;
    }
    panActive = true;
    panMoved = false;
    panPointerId = ev.pointerId;
    panLastX = ev.clientX;
    panLastY = ev.clientY;
    stage.classList.add('is-panning');
    try {
      stage.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* ignore */
    }
    ev.preventDefault();
  }

  function onStagePointerMove(ev) {
    if (!panActive || ev.pointerId !== panPointerId) {
      return;
    }
    const dx = ev.clientX - panLastX;
    const dy = ev.clientY - panLastY;
    if (dx !== 0 || dy !== 0) {
      panMoved = true;
    }
    panLastX = ev.clientX;
    panLastY = ev.clientY;
    viewX += dx;
    viewY += dy;
    applyViewTransform();
    ev.preventDefault();
  }

  function endPan(ev) {
    if (!panActive) {
      return;
    }
    if (ev && panPointerId != null && ev.pointerId !== panPointerId) {
      return;
    }
    panActive = false;
    panPointerId = null;
    if (stage) {
      stage.classList.remove('is-panning');
    }
  }

  function onStagePointerUp(ev) {
    endPan(ev);
  }

  function onStageDblClick(ev) {
    if (!stage) {
      return;
    }
    resetView();
    ev.preventDefault();
  }

  function bindStageView() {
    if (!stage) {
      return;
    }
    stage.addEventListener('wheel', onStageWheel, { passive: false });
    stage.addEventListener('pointerdown', onStagePointerDown);
    stage.addEventListener('pointermove', onStagePointerMove);
    stage.addEventListener('pointerup', onStagePointerUp);
    stage.addEventListener('pointercancel', onStagePointerUp);
    stage.addEventListener('lostpointercapture', onStagePointerUp);
    stage.addEventListener('dblclick', onStageDblClick);
    // prevent native image drag
    if (streamImage) {
      streamImage.addEventListener('dragstart', function (e) {
        e.preventDefault();
      });
    }
    applyViewTransform();
  }

    function setHistUiEnabled(on) {
    if (histPanel) {
      histPanel.hidden = !on;
    }
    if (!on) {
      hideHistTooltip();
    }
  }

  function clearHistogram() {
    histPending = false;
    histState = null;
    histHover = null;
    hideHistTooltip();
    if (histCharts) {
      histCharts.innerHTML = '';
    }
    histViews = [];
    if (histMeta) {
      histMeta.textContent = '-';
    }
  }

  function hideHistTooltip() {
    if (histTooltip) {
      histTooltip.hidden = true;
      histTooltip.textContent = '';
    }
  }

  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function rgbToXyz(r, g, b) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    // D65
    return {
      x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
      y: R * 0.2126729 + G * 0.7151522 + B * 0.072175,
      z: R * 0.0193339 + G * 0.119192 + B * 0.9503041,
    };
  }

  function xyzToLab(x, y, z) {
    // D65 white
    let fx = x / 0.95047;
    let fy = y / 1.0;
    let fz = z / 1.08883;
    const e = 216 / 24389;
    const k = 24389 / 27;
    fx = fx > e ? Math.cbrt(fx) : (k * fx + 16) / 116;
    fy = fy > e ? Math.cbrt(fy) : (k * fy + 16) / 116;
    fz = fz > e ? Math.cbrt(fz) : (k * fz + 16) / 116;
    return {
      L: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz),
    };
  }

  function rgbToLabBins(r, g, b) {
    const xyz = rgbToXyz(r, g, b);
    const lab = xyzToLab(xyz.x, xyz.y, xyz.z);
    const L = Math.max(0, Math.min(255, Math.round((lab.L / 100) * 255)));
    const a = Math.max(0, Math.min(255, Math.round(lab.a + 128)));
    const bb = Math.max(0, Math.min(255, Math.round(lab.b + 128)));
    return [L, a, bb];
  }

  function rgbToYuvBins(r, g, b) {
    // BT.601 full-range style mapping to 0..255
    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const U = -0.14713 * r - 0.28886 * g + 0.436 * b + 128;
    const V = 0.615 * r - 0.51499 * g - 0.10001 * b + 128;
    return [
      Math.max(0, Math.min(255, Math.round(Y))),
      Math.max(0, Math.min(255, Math.round(U))),
      Math.max(0, Math.min(255, Math.round(V))),
    ];
  }

  function rgbToHsvBins(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d > 1e-8) {
      if (max === rn) {
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      } else if (max === gn) {
        h = ((bn - rn) / d + 2) / 6;
      } else {
        h = ((rn - gn) / d + 4) / 6;
      }
    }
    const s = max <= 1e-8 ? 0 : d / max;
    const v = max;
    return [
      Math.max(0, Math.min(255, Math.round(h * 255))),
      Math.max(0, Math.min(255, Math.round(s * 255))),
      Math.max(0, Math.min(255, Math.round(v * 255))),
    ];
  }

  function ensureHistSample(w, h) {
    if (!histSampleCanvas) {
      histSampleCanvas = document.createElement('canvas');
      histSampleCtx = histSampleCanvas.getContext('2d', {
        willReadFrequently: true,
      });
    }
    if (histSampleCanvas.width !== w || histSampleCanvas.height !== h) {
      histSampleCanvas.width = w;
      histSampleCanvas.height = h;
    }
    return histSampleCtx;
  }

  function sampleSize(nw, nh) {
    // 0 / full = no downsample
    if (!histMaxEdge || histMaxEdge <= 0) {
      return { w: nw, h: nh };
    }
    const edge = Math.max(nw, nh);
    if (edge <= histMaxEdge) {
      return { w: nw, h: nh };
    }
    const scale = histMaxEdge / edge;
    return {
      w: Math.max(1, Math.round(nw * scale)),
      h: Math.max(1, Math.round(nh * scale)),
    };
  }

  function loadViewerSettings() {
    try {
      const st = vscode.getState && vscode.getState();
      const s = (st && st.viewerSettings) || null;
      if (!s) {
        return;
      }
      if (s.histQuality === 'full' || s.histQuality === 0 || s.histQuality === '0') {
        histMaxEdge = 0;
        if (histQuality) {
          histQuality.value = 'full';
        }
      } else if (s.histQuality != null) {
        const n = parseInt(s.histQuality, 10);
        if (n === 160 || n === 320 || n === 640) {
          histMaxEdge = n;
          if (histQuality) {
            histQuality.value = String(n);
          }
        }
      }
      if (s.histMinMs != null) {
        const ms = Math.max(30, Math.min(1000, parseInt(s.histMinMs, 10) || 120));
        histMinMs = ms;
        if (histIntervalInput) {
          histIntervalInput.value = String(ms);
        }
      }
      if (s.httpInterval != null && intervalInput) {
        intervalInput.value = String(
          Math.max(16, Math.min(2000, parseInt(s.httpInterval, 10) || 33))
        );
      }
      if (typeof s.autoReconnect === 'boolean' && autoReconnect) {
        autoReconnect.checked = s.autoReconnect;
      }
      if (
        s.mode === 'http' ||
        s.mode === 'websocket' ||
        s.mode === 'mjpeg'
      ) {
        currentMode = s.mode;
        streamModes.forEach(function (m) {
          m.classList.toggle('active', m.dataset.mode === currentMode);
        });
      }
      if (typeof s.hud === 'boolean' && overlayToggle) {
        overlayToggle.checked = s.hud;
      }
      if (typeof s.hist === 'boolean' && histogramToggle) {
        histogramToggle.checked = s.hist;
      }
      if (s.histSpace && histSpace) {
        histSpace.value = s.histSpace;
      }
    } catch (e) {
      /* ignore */
    }
  }

  function saveViewerSettings() {
    try {
      const prev = (vscode.getState && vscode.getState()) || {};
      const quality = histMaxEdge <= 0 ? 'full' : String(histMaxEdge);
      const next = Object.assign({}, prev, {
        viewerSettings: {
          histQuality: quality,
          histMinMs: histMinMs,
          httpInterval: intervalInput
            ? parseInt(intervalInput.value, 10) || 33
            : 33,
          autoReconnect: !!(autoReconnect && autoReconnect.checked),
          mode: currentMode,
          hud: !!(overlayToggle && overlayToggle.checked),
          hist: !!(histogramToggle && histogramToggle.checked),
          histSpace: (histSpace && histSpace.value) || 'rgb',
        },
      });
      if (vscode.setState) {
        vscode.setState(next);
      }
    } catch (e) {
      /* ignore */
    }
  }

  function applyHistQualityFromUi() {
    if (!histQuality) {
      return;
    }
    const v = histQuality.value;
    if (v === 'full') {
      histMaxEdge = 0;
    } else {
      const n = parseInt(v, 10);
      histMaxEdge = n === 160 || n === 640 ? n : 320;
    }
    saveViewerSettings();
    forceHistogram();
  }

  function applyHistIntervalFromUi() {
    if (!histIntervalInput) {
      return;
    }
    histMinMs = Math.max(30, Math.min(1000, parseInt(histIntervalInput.value, 10) || 120));
    histIntervalInput.value = String(histMinMs);
    saveViewerSettings();
  }

  function setSettingsOpen(open) {
    if (!settingsPanel) {
      return;
    }
    settingsPanel.hidden = !open;
    if (settingsBtn) {
      settingsBtn.classList.toggle('active', !!open);
    }
    if (open) {
      setLogOpen(false);
    }
  }

  function toggleSettings() {
    if (!settingsPanel) {
      return;
    }
    setSettingsOpen(!!settingsPanel.hidden);
  }

  function setLogOpen(open) {
    if (!logPanel) {
      return;
    }
    logPanel.hidden = !open;
    if (logBtn) {
      logBtn.classList.toggle('active', !!open);
    }
    if (open) {
      setSettingsOpen(false);
      if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
      }
    }
  }

  function toggleLog() {
    if (!logPanel) {
      return;
    }
    setLogOpen(!!logPanel.hidden);
  }

  function clearLog() {
    if (!logContainer) {
      return;
    }
    logContainer.innerHTML = '';
  }

  function accumulateHistogram(data, space) {
    const n = space === 'gray' ? 1 : 3;
    const bins = [];
    for (let c = 0; c < n; c++) {
      bins.push(new Uint32Array(HIST_BINS));
    }
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      let vals;
      if (space === 'rgb') {
        vals = [r, g, b];
      } else if (space === 'gray') {
        vals = [Math.round(0.299 * r + 0.587 * g + 0.114 * b)];
      } else if (space === 'lab') {
        vals = rgbToLabBins(r, g, b);
      } else if (space === 'yuv') {
        vals = rgbToYuvBins(r, g, b);
      } else if (space === 'hsv') {
        vals = rgbToHsvBins(r, g, b);
      } else {
        vals = [r, g, b];
      }
      for (let c = 0; c < n; c++) {
        bins[c][vals[c]]++;
      }
    }
    return bins;
  }

  function channelStats(binArr, samplePixels) {
    let minBin = -1;
    let maxBin = -1;
    let maxCount = 0;
    let sum = 0;
    let sumW = 0;
    for (let i = 0; i < HIST_BINS; i++) {
      const c = binArr[i];
      if (c > 0) {
        if (minBin < 0) {
          minBin = i;
        }
        maxBin = i;
        sum += c;
        sumW += c * i;
        if (c > maxCount) {
          maxCount = c;
        }
      }
    }
    const mean = sum > 0 ? sumW / sum : 0;
    const pctPeak = samplePixels > 0 ? (maxCount / samplePixels) * 100 : 0;
    return {
      minBin: minBin < 0 ? 0 : minBin,
      maxBin: maxBin < 0 ? 0 : maxBin,
      maxCount: maxCount,
      mean: mean,
      peakPct: pctPeak,
      total: sum,
    };
  }

  function ensureHistViews(count) {
    if (!histCharts) {
      return;
    }
    // always stack channels vertically, equal height
    histCharts.style.gridTemplateColumns = '1fr';
    histCharts.style.gridTemplateRows = count > 0 ? 'repeat(' + count + ', minmax(0, 1fr))' : '';
    if (histViews.length === count) {
      return;
    }
    histCharts.innerHTML = '';
    histViews = [];
    for (let i = 0; i < count; i++) {
      const card = document.createElement('div');
      card.className = 'hist-chart';
      const head = document.createElement('div');
      head.className = 'hist-chart-head';
      const ch = document.createElement('span');
      ch.className = 'ch';
      const sw = document.createElement('i');
      const label = document.createElement('span');
      label.className = 'label';
      ch.appendChild(sw);
      ch.appendChild(label);
      const stats = document.createElement('span');
      stats.className = 'stats';
      head.appendChild(ch);
      head.appendChild(stats);
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 96;
      canvas.dataset.ch = String(i);
      card.appendChild(head);
      card.appendChild(canvas);
      histCharts.appendChild(card);
      histViews.push({
        card: card,
        sw: sw,
        label: label,
        stats: stats,
        canvas: canvas,
        padL: 4,
        padR: 4,
        padT: 4,
        padB: 4,
      });
      canvas.addEventListener('mousemove', onHistCanvasMove);
      canvas.addEventListener('mouseleave', onHistCanvasLeave);
      canvas.addEventListener('mouseenter', onHistCanvasMove);
    }
  }

  function binFromEvent(view, ev) {
    const rect = view.canvas.getBoundingClientRect();
    if (rect.width <= 0) {
      return -1;
    }
    const x = ev.clientX - rect.left;
    const plotW = rect.width * ((view.canvas.width - view.padL - view.padR) / view.canvas.width);
    const padLcss = rect.width * (view.padL / view.canvas.width);
    const rel = x - padLcss;
    if (rel < 0 || rel > plotW) {
      return -1;
    }
    const t = rel / plotW;
    return Math.max(0, Math.min(HIST_BINS - 1, Math.round(t * (HIST_BINS - 1))));
  }

  function onHistCanvasMove(ev) {
    if (!histState || !histTooltip) {
      return;
    }
    const canvas = ev.currentTarget;
    const ch = parseInt(canvas.dataset.ch, 10);
    const view = histViews[ch];
    if (!view) {
      return;
    }
    const bin = binFromEvent(view, ev);
    if (bin < 0) {
      histHover = null;
      hideHistTooltip();
      redrawHistCharts();
      return;
    }
    histHover = { ch: ch, bin: bin };
    redrawHistCharts();
    showHistTooltip(ch, bin, ev.clientX, ev.clientY);
  }

  function onHistCanvasLeave() {
    histHover = null;
    hideHistTooltip();
    redrawHistCharts();
  }

  function showHistTooltip(ch, bin, clientX, clientY) {
    if (!histTooltip || !histState) {
      return;
    }
    const cfg = HIST_SPACES[histState.space] || HIST_SPACES.rgb;
    const arr = histState.bins[ch];
    if (!arr) {
      return;
    }
    const count = arr[bin];
    const samplePixels = histState.samplePixels || 1;
    const pct = samplePixels > 0 ? (count / samplePixels) * 100 : 0;
    const label = cfg.labels[ch] || 'Ch' + ch;
    const desc = cfg.describe
      ? cfg.describe.call(cfg, ch, bin)
      : label + ' = ' + bin;
    histTooltip.innerHTML =
      '<div class="tt-title">' +
      label +
      ' <b>' +
      bin +
      '</b></div>' +
      desc +
      '\ncount <b>' +
      count +
      '</b> · <b>' +
      pct.toFixed(1) +
      '%</b>';
    histTooltip.hidden = false;
    const pad = 10;
    const tw = histTooltip.offsetWidth || 140;
    const th = histTooltip.offsetHeight || 48;
    let left = clientX + pad;
    let top = clientY + pad;
    if (left + tw > window.innerWidth - 4) {
      left = clientX - tw - pad;
    }
    if (top + th > window.innerHeight - 4) {
      top = clientY - th - pad;
    }
    if (left < 4) {
      left = 4;
    }
    if (top < 4) {
      top = 4;
    }
    histTooltip.style.left = left + 'px';
    histTooltip.style.top = top + 'px';
  }

  function formatAxisCount(n) {
    if (n >= 1000000) {
      return (n / 1000000).toFixed(1) + 'M';
    }
    if (n >= 1000) {
      return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    }
    return String(Math.round(n));
  }

  function niceMax(v) {
    if (v <= 1) {
      return 1;
    }
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    const m = v / base;
    let nice;
    if (m <= 1) {
      nice = 1;
    } else if (m <= 2) {
      nice = 2;
    } else if (m <= 5) {
      nice = 5;
    } else {
      nice = 10;
    }
    return nice * base;
  }

  function histCanvasCssHeight(view) {
    // Prefer laid-out canvas box (equal vertical cells)
    if (view && view.canvas) {
      const ch = view.canvas.clientHeight;
      if (ch > 8) {
        HIST_CSS_H = ch;
        return HIST_CSS_H;
      }
      // card body minus head if canvas not sized yet
      if (view.card) {
        const headEl = view.card.querySelector('.hist-chart-head');
        const headH = headEl ? headEl.offsetHeight + 4 : 18;
        const body = view.card.clientHeight - headH;
        if (body > 8) {
          HIST_CSS_H = body;
          return HIST_CSS_H;
        }
      }
    }
    if (histViews && histViews.length) {
      for (let i = 0; i < histViews.length; i++) {
        const v = histViews[i];
        if (v && v.canvas && v.canvas.clientHeight > 8) {
          HIST_CSS_H = v.canvas.clientHeight;
          return HIST_CSS_H;
        }
      }
    }
    if (!histPanel || histPanel.hidden) {
      return Math.max(HIST_CSS_H, 56);
    }
    const head = histPanel.querySelector('.hist-dock-head');
    const headH = head ? head.offsetHeight + 6 : 22;
    const pad = 14;
    const n = Math.max(1, (histViews && histViews.length) || (histState && histState.bins && histState.bins.length) || 3);
    const avail = Math.max(40, (histPanel.clientHeight || histDockHeight) - headH - pad);
    const gap = 4 * Math.max(0, n - 1);
    const per = (avail - gap) / n;
    // chart head ~18px inside each card
    HIST_CSS_H = Math.max(36, Math.floor(per - 20));
    return HIST_CSS_H;
  }

  function applyHistDockHeight(h) {
    if (!histPanel) {
      return;
    }
    const bodyH = document.body ? document.body.clientHeight : 600;
    const maxH = Math.max(HIST_DOCK_MIN_H, Math.floor(bodyH * 0.8));
    histDockHeight = Math.max(HIST_DOCK_MIN_H, Math.min(maxH, Math.round(h)));
    histPanel.style.height = histDockHeight + 'px';
    histPanel.style.maxHeight = '80%';
  }

  function bindHistResize() {
    if (!histResize || !histPanel) {
      return;
    }
    histResize.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) {
        return;
      }
      histResizeActive = true;
      histResizeStartY = ev.clientY;
      histResizeStartH = histPanel.getBoundingClientRect().height;
      document.body.classList.add('hist-resizing');
      try {
        histResize.setPointerCapture(ev.pointerId);
      } catch (e) {
        /* ignore */
      }
      ev.preventDefault();
      ev.stopPropagation();
    });
    histResize.addEventListener('pointermove', function (ev) {
      if (!histResizeActive) {
        return;
      }
      // drag handle at top of dock: drag up → taller dock
      const dy = histResizeStartY - ev.clientY;
      applyHistDockHeight(histResizeStartH + dy);
      if (histState) {
        redrawHistCharts();
      }
      applyViewTransform();
      ev.preventDefault();
    });
    function endResize(ev) {
      if (!histResizeActive) {
        return;
      }
      histResizeActive = false;
      document.body.classList.remove('hist-resizing');
      if (histState) {
        redrawHistCharts();
      }
      applyViewTransform();
    }
    histResize.addEventListener('pointerup', endResize);
    histResize.addEventListener('pointercancel', endResize);
    histResize.addEventListener('lostpointercapture', endResize);
    applyHistDockHeight(histDockHeight);
  }

  function drawChannelChart(view, binArr, color, hoverBin) {
    const canvas = view.canvas;
    const cssH = Math.max(40, histCanvasCssHeight(view));
    const cssW = Math.max(80, Math.floor(canvas.clientWidth || (view.card && view.card.clientWidth) || 240));
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(120, Math.round(cssW * dpr));
    const h = Math.max(48, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const padL = Math.round(30 * dpr);
    const padR = Math.round(8 * dpr);
    const padT = Math.round(8 * dpr);
    const padB = Math.round(18 * dpr);
    view.padL = padL;
    view.padR = padR;
    view.padT = padT;
    view.padB = padB;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    let maxVal = 1;
    for (let i = 0; i < HIST_BINS; i++) {
      if (binArr[i] > maxVal) {
        maxVal = binArr[i];
      }
    }
    const yMax = niceMax(maxVal);
    // grid + Y ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    ctx.fillStyle = 'rgba(180,180,180,0.85)';
    ctx.font = Math.max(9, Math.round(9 * dpr)) + 'px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const t = i / yTicks;
      const y = padT + plotH * (1 - t);
      const val = yMax * t;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(formatAxisCount(val), padL - 4 * dpr, y);
    }
    // X ticks: 0, 64, 128, 192, 255
    const xTickVals = [0, 64, 128, 192, 255];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let ti = 0; ti < xTickVals.length; ti++) {
      const bv = xTickVals[ti];
      const x = padL + (bv / (HIST_BINS - 1)) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = 'rgba(180,180,180,0.85)';
      ctx.fillText(String(bv), x, padT + plotH + 3 * dpr);
    }
    // axes
    ctx.strokeStyle = 'rgba(220,220,220,0.45)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();
    // filled area + stroke
    ctx.beginPath();
    for (let i = 0; i < HIST_BINS; i++) {
      const x = padL + (i / (HIST_BINS - 1)) * plotW;
      const y = padT + plotH - (binArr[i] / yMax) * plotH;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.stroke();
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.lineTo(padL, padT + plotH);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    // hover marker
    if (hoverBin != null && hoverBin >= 0) {
      const x = padL + (hoverBin / (HIST_BINS - 1)) * plotW;
      const y = padT + plotH - (binArr[hoverBin] / yMax) * plotH;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, dpr * 0.8);
      ctx.stroke();
    }
  }

  function redrawHistCharts() {
    if (!histState || !histViews.length) {
      return;
    }
    const cfg = HIST_SPACES[histState.space] || HIST_SPACES.rgb;
    const samplePixels = histState.samplePixels || 1;
    for (let c = 0; c < histState.bins.length; c++) {
      const view = histViews[c];
      if (!view) {
        continue;
      }
      const color = cfg.colors[c] || '#fff';
      view.sw.style.background = color;
      view.label.textContent = cfg.labels[c] || 'Ch' + c;
      const st = channelStats(histState.bins[c], samplePixels);
      view.stats.textContent =
        'μ ' +
        st.mean.toFixed(0) +
        ' · max ' +
        st.maxCount +
        ' · ' +
        st.peakPct.toFixed(1) +
        '%';
      const hoverBin =
        histHover && histHover.ch === c ? histHover.bin : null;
      drawChannelChart(view, histState.bins[c], color, hoverBin);
    }
  }

  function drawHistogram(bins, space, sampleW, sampleH) {
    const cfg = HIST_SPACES[space] || HIST_SPACES.rgb;
    const samplePixels = sampleW * sampleH;
    histState = {
      space: space,
      bins: bins,
      samplePixels: samplePixels,
      sampleW: sampleW,
      sampleH: sampleH,
    };
    ensureHistViews(bins.length);
    if (histMeta) {
      const q =
        histMaxEdge <= 0
          ? 'full'
          : sampleW + '×' + sampleH;
      histMeta.textContent =
        cfg.name +
        ' · ' +
        q +
        ' · ' +
        bins.length +
        ' ch';
    }
    // keep hover if still valid
    if (histHover && histHover.ch >= bins.length) {
      histHover = null;
      hideHistTooltip();
    }
    redrawHistCharts();
    // first layout often has 0-size canvases; redraw after flex/grid settles
    requestAnimationFrame(function () {
      if (!histState) {
        return;
      }
      redrawHistCharts();
      requestAnimationFrame(function () {
        if (histState) {
          redrawHistCharts();
        }
      });
    });
    if (histHover) {
      const view = histViews[histHover.ch];
      if (view) {
        const rect = view.canvas.getBoundingClientRect();
        showHistTooltip(
          histHover.ch,
          histHover.bin,
          rect.left + rect.width / 2,
          rect.top + 8
        );
      }
    }
  }

  function scheduleHistogram(force) {
    if (!histogramToggle || !histogramToggle.checked) {
      return;
    }
    // allow hist from last frame even after stop; while streaming prefer live frames
    if (!streamImage || !streamImage.naturalWidth || !streamImage.naturalHeight) {
      if (force) {
        histPending = true;
      }
      return;
    }
    const now = performance.now();
    if (histBusy) {
      histPending = true;
      return;
    }
    if (!force && now - histThrottle < histMinMs) {
      histPending = true;
      return;
    }
    histThrottle = now;
    histPending = false;
    updateHistogram();
  }

  function forceHistogram() {
    histThrottle = 0;
    scheduleHistogram(true);
  }

  function updateHistogram() {
    if (!histogramToggle || !histogramToggle.checked) {
      return;
    }
    if (!streamImage || !streamImage.naturalWidth || !streamImage.naturalHeight) {
      return;
    }
    histBusy = true;
    try {
      const nw = streamImage.naturalWidth;
      const nh = streamImage.naturalHeight;
      const sz = sampleSize(nw, nh);
      const ctx = ensureHistSample(sz.w, sz.h);
      if (!ctx) {
        histBusy = false;
        return;
      }
      ctx.drawImage(streamImage, 0, 0, sz.w, sz.h);
      let data;
      try {
        data = ctx.getImageData(0, 0, sz.w, sz.h).data;
      } catch (e) {
        histBusy = false;
        return;
      }
      const space = (histSpace && histSpace.value) || 'rgb';
      const bins = accumulateHistogram(data, space);
      drawHistogram(bins, space, sz.w, sz.h);
    } catch (e) {
      /* ignore hist errors */
    }
    histBusy = false;
    if (histPending && histogramToggle.checked && isStreaming) {
      histPending = false;
      const wait = Math.max(0, histMinMs - (performance.now() - histThrottle));
      setTimeout(function () {
        if (histogramToggle.checked && isStreaming) {
          histThrottle = 0;
          scheduleHistogram();
        }
      }, wait);
    }
  }

  function onHistToggle() {
    const on = !!(histogramToggle && histogramToggle.checked);
    setHistUiEnabled(on);
    if (on) {
      applyHistDockHeight(histDockHeight);
      histThrottle = 0;
      // auto-start stream when enabling hist so data arrives
      if (!isStreaming && currentDevice && httpBase) {
        startStream();
      }
      // layout then compute so canvas clientWidth is valid
      requestAnimationFrame(function () {
        forceHistogram();
        applyViewTransform();
      });
    } else {
      clearHistogram();
      applyViewTransform();
    }
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
    let paintSettled = false;
    function settle() {
      if (paintSettled) {
        return;
      }
      paintSettled = true;
      streamImage.removeEventListener('load', settle);
      streamImage.removeEventListener('error', settle);
      if (prev && prev !== objectUrl) {
        URL.revokeObjectURL(prev);
      }
      lastPaint = performance.now();
      if (m || s != null) {
        applyMeta(m, s);
      }
      // force hist as soon as frame is ready (dock may need a layout frame)
      if (histogramToggle && histogramToggle.checked) {
        if (histPanel && histPanel.hidden) {
          setHistUiEnabled(true);
          applyHistDockHeight(histDockHeight);
        }
        requestAnimationFrame(function () {
          forceHistogram();
          requestAnimationFrame(function () {
            forceHistogram();
          });
        });
      }
      painting = false;
      if (pendingBlob && isStreaming) {
        paintBlob(pendingBlob, pendingMeta, pendingSize);
      }
    }
    streamImage.addEventListener('load', settle);
    streamImage.addEventListener('error', settle);
    streamImage.src = next;
    // cached/same-url decode may already be complete
    if (streamImage.complete && streamImage.naturalWidth) {
      settle();
    }
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
    metricFps = '0';
    metricKb = '0';
    metricRes = '-';
    metricLatency = '-';
  }

  function bumpFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFPSUpdate >= 1000) {
      metricFps = String(frameCount);
      frameCount = 0;
      lastFPSUpdate = now;
    }
  }

  function applyMeta(meta, size, force) {
    bumpFps();
    const now = performance.now();
    if (!force && now - metaThrottle < 100) {
      if (size != null) {
        metricKb = String(Math.round(size / 1024));
      }
      updateOverlay();
      return;
    }
    metaThrottle = now;
    if (size != null) {
      metricKb = String(Math.round(size / 1024));
    }
    if (meta) {
      if (meta.width && meta.height) {
        metricRes = meta.width + '\u00d7' + meta.height;
      }
      if (meta.ts) {
        const ts = typeof meta.ts === 'string' ? parseInt(meta.ts, 10) : meta.ts;
        metricLatency = Math.max(0, Date.now() - ts) + 'ms';
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
    let zoomTxt = '';
    if (Math.abs(viewScale - 1) >= 0.001) {
      zoomTxt = ' · ' + Math.round(viewScale * 100) + '%';
    }
    overlayInfo.textContent =
      metricFps +
      'fps · ' +
      metricKb +
      'KB · ' +
      metricLatency +
      (metricRes !== '-' ? ' · ' + metricRes : '') +
      ' · ' +
      currentMode.toUpperCase() +
      zoomTxt;
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

  function syncStreamButtons() {
    const hasDevice = !!currentDevice;
    const busy = isStreaming || streamStarting;
    if (streamBtn) {
      streamBtn.disabled = !hasDevice && !busy;
      streamBtn.innerHTML = busy ? ICON_STOP : ICON_PLAY;
      streamBtn.title = busy ? streamBtnStopLabel : streamBtnStartLabel;
      streamBtn.setAttribute(
        'aria-label',
        busy ? streamBtnStopLabel : streamBtnStartLabel
      );
      streamBtn.classList.toggle('is-running', busy);
      streamBtn.classList.toggle('primary', !busy);
    }
    if (screenshotBtn) {
      const hasFrame = !!(streamImage && streamImage.naturalWidth);
      screenshotBtn.disabled = !hasDevice || (!busy && !hasFrame);
    }
  }

  function toggleStream() {
    if (isStreaming || streamStarting) {
      stopStream();
      return;
    }
    startStream();
  }

  function stopStream(silent) {
    isStreaming = false;
    streamStarting = false;
    clearTimers();
    closeWs();
    abortHttp();
    pendingBlob = null;
    pendingMeta = null;
    pendingSize = null;
    painting = false;
    streamImage.removeAttribute('src');
    revokeObjectUrl();
    // keep last histogram when stopped
    syncStreamButtons();
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
      streamStarting = false;
      syncStreamButtons();
      return;
    }
    streamStarting = true;
    syncStreamButtons();
    stopStream(true);
    isStreaming = true;
    streamStarting = false;
    syncStreamButtons();
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
      forceHistogram();
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
        forceHistogram();
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
    saveViewerSettings();
    vscode.postMessage({ type: 'modeChanged', mode: mode });
    if (was && currentDevice) {
      startStream();
    } else {
      syncStreamButtons();
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
    syncStreamButtons();
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
    } else if (devices.length >= 1) {
      // auto-pick first connected device so Start / auto-stream can run
      deviceSelect.value = devices[0].key;
      currentDevice = devices[0].key;
    } else if (prev && currentDevice === prev) {
      stopStream();
      currentDevice = null;
      updateStatus('Disconnected', 'error');
    } else {
      currentDevice = null;
    }
    syncStreamButtons();
  }

  function ensureHistEnabled() {
    if (!histogramToggle) {
      return;
    }
    // respect checkbox (default checked; may be restored from settings)
    const on = !!histogramToggle.checked;
    setHistUiEnabled(on);
    if (on) {
      applyHistDockHeight(histDockHeight);
    }
  }

  /** Start stream + hist when device/service ready (idempotent). */
  function tryAutoStartStream() {
    if (!preferAutoStart || isStreaming || streamStarting) {
      syncStreamButtons();
      return;
    }
    if (!currentDevice || !httpBase) {
      syncStreamButtons();
      return;
    }
    ensureHistEnabled();
    streamStarting = true;
    syncStreamButtons();
    updateStatus('Connecting', 'connecting');
    requestAnimationFrame(function () {
      applyHistDockHeight(histDockHeight);
      if (!preferAutoStart || isStreaming) {
        streamStarting = false;
        syncStreamButtons();
        return;
      }
      if (!currentDevice || !httpBase) {
        streamStarting = false;
        syncStreamButtons();
        return;
      }
      startStream();
    });
  }

  deviceSelect.addEventListener('change', onDeviceChange);
  if (streamBtn) {
    streamBtn.addEventListener('click', toggleStream);
  }
  screenshotBtn.addEventListener('click', takeScreenshot);
  if (fitViewBtn) {
    fitViewBtn.addEventListener('click', function () {
      resetView();
    });
  }
  if (overlayToggle) {
    overlayToggle.addEventListener('change', function () {
      updateOverlay();
      saveViewerSettings();
    });
  }
  if (histogramToggle) {
    histogramToggle.addEventListener('change', function () {
      onHistToggle();
      saveViewerSettings();
    });
  }
  if (histSpace) {
    histSpace.addEventListener('change', function () {
      forceHistogram();
      saveViewerSettings();
    });
  }
  let histResizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(histResizeTimer);
    histResizeTimer = setTimeout(function () {
      if (histPanel && !histPanel.hidden) {
        applyHistDockHeight(histDockHeight);
      }
      applyViewTransform();
      if (histState) {
        redrawHistCharts();
      }
    }, 80);
  });
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
      // host defaults only if user has not saved mode/interval
      const st = (vscode.getState && vscode.getState()) || {};
      const saved = st.viewerSettings || {};
      if (!saved.mode) {
        currentMode = message.defaultMode || 'websocket';
        if (currentMode !== 'http' && currentMode !== 'mjpeg') {
          currentMode = 'websocket';
        }
      }
      streamModes.forEach(function (m) {
        m.classList.toggle('active', m.dataset.mode === currentMode);
      });
      if (message.httpInterval && !saved.httpInterval && intervalInput) {
        intervalInput.value = String(message.httpInterval);
      }
      // always auto-start stream + hist on webview open (host may still pass false)
      preferAutoStart = message.autoStart !== false;
      fillDevices(message.devices || []);
      log(httpBase || 'no service');
      ensureHistEnabled();
      syncStreamButtons();
      tryAutoStartStream();
    } else if (message.type === 'updateDeviceList') {
      const hadDevice = !!currentDevice;
      fillDevices(message.devices || []);
      // device connected after webview opened → start stream + hist
      if (preferAutoStart && currentDevice && (!hadDevice || !isStreaming)) {
        tryAutoStartStream();
      }
    } else if (message.type === 'serviceEndpoints') {
      httpBase = message.httpBase || httpBase;
      wsUrl = message.wsUrl || wsUrl;
      tryAutoStartStream();
    }
  });

  bindStageView();
  bindHistResize();
  loadViewerSettings();
  ensureHistEnabled();
  updateOverlay();
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleSettings();
    });
  }
  if (settingsClose) {
    settingsClose.addEventListener('click', function () {
      setSettingsOpen(false);
    });
  }
  if (logBtn) {
    logBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleLog();
    });
  }
  if (logClose) {
    logClose.addEventListener('click', function () {
      setLogOpen(false);
    });
  }
  if (logClearBtn) {
    logClearBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      clearLog();
    });
  }
  if (histQuality) {
    histQuality.addEventListener('change', applyHistQualityFromUi);
  }
  if (histIntervalInput) {
    histIntervalInput.addEventListener('change', applyHistIntervalFromUi);
  }
  if (autoReconnect) {
    autoReconnect.addEventListener('change', saveViewerSettings);
  }
  if (intervalInput) {
    intervalInput.addEventListener('change', saveViewerSettings);
  }
  document.addEventListener('click', function (ev) {
    const t = ev.target;
    if (settingsPanel && !settingsPanel.hidden) {
      if (
        !settingsPanel.contains(t) &&
        !(settingsBtn && settingsBtn.contains(t))
      ) {
        setSettingsOpen(false);
      }
    }
    if (logPanel && !logPanel.hidden) {
      if (!logPanel.contains(t) && !(logBtn && logBtn.contains(t))) {
        setLogOpen(false);
      }
    }
  });
  ensureHistEnabled();
  syncStreamButtons();
  vscode.postMessage({ type: 'ready' });
})();
