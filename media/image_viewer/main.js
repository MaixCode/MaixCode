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
  const intervalInput = document.getElementById('intervalInput');
  const overlayToggle = document.getElementById('overlayToggle');
  const histogramToggle = document.getElementById('histogramToggle');
  const histSpace = document.getElementById('histSpace');
  const histPanel = document.getElementById('histPanel');
  const histCharts = document.getElementById('histCharts');
  const histMeta = document.getElementById('histMeta');
  const histTooltip = document.getElementById('histTooltip');
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
  let histThrottle = 0;
  let histBusy = false;
  let histPending = false;
  let histSampleCanvas = null;
  let histSampleCtx = null;
  let histState = null; // { space, bins, samplePixels, sampleW, sampleH }
  let histViews = []; // per-channel canvas views
  let histHover = null; // { ch, bin }
  const HIST_BINS = 256;
  const HIST_MAX_EDGE = 160;
  const HIST_MIN_MS = 120;
  const HIST_CSS_H = 72;
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

  function setHistUiEnabled(on) {
    if (histSpace) {
      histSpace.disabled = !on;
    }
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
    const edge = Math.max(nw, nh);
    if (edge <= HIST_MAX_EDGE) {
      return { w: nw, h: nh };
    }
    const scale = HIST_MAX_EDGE / edge;
    return {
      w: Math.max(1, Math.round(nw * scale)),
      h: Math.max(1, Math.round(nh * scale)),
    };
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
    const pct = (count / samplePixels) * 100;
    // cumulative percentile of this bin value
    let below = 0;
    for (let i = 0; i < bin; i++) {
      below += arr[i];
    }
    const cdfLo = (below / samplePixels) * 100;
    const cdfHi = ((below + count) / samplePixels) * 100;
    const st = channelStats(arr, samplePixels);
    const desc = cfg.describe
      ? cfg.describe.call(cfg, ch, bin)
      : 'value ' + bin;
    const lines = [
      '<div class="tt-title">' +
        (cfg.fullNames[ch] || cfg.labels[ch] || 'Ch' + ch) +
        ' · bin <b>' +
        bin +
        '</b></div>',
      desc,
      'Range: ' + (cfg.units[ch] || '0–255'),
      'Count: <b>' + count + '</b> / ' + samplePixels + ' samples',
      'Share: <b>' + pct.toFixed(2) + '%</b>',
      'CDF: <b>' + cdfLo.toFixed(1) + '–' + cdfHi.toFixed(1) + '%</b>',
      'Channel mean: ' + st.mean.toFixed(1) + ' · peak ' + st.maxCount + ' @ ' + (function () {
        let peakBin = 0;
        let peak = 0;
        for (let i = 0; i < HIST_BINS; i++) {
          if (arr[i] > peak) {
            peak = arr[i];
            peakBin = i;
          }
        }
        return peakBin;
      })(),
      'Sample: ' + histState.sampleW + '×' + histState.sampleH + ' · space ' + cfg.name,
    ];
    histTooltip.innerHTML = lines.join('\n');
    histTooltip.hidden = false;
    // position near cursor, clamp to viewport
    const pad = 12;
    const tw = histTooltip.offsetWidth || 180;
    const th = histTooltip.offsetHeight || 120;
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

  function drawChannelChart(view, binArr, color, hoverBin) {
    const canvas = view.canvas;
    const cssW = Math.max(120, Math.floor(canvas.clientWidth || canvas.parentElement.clientWidth || 240));
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(120, Math.round(cssW * dpr));
    const h = Math.round(HIST_CSS_H * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const padL = Math.round(4 * dpr);
    const padR = Math.round(4 * dpr);
    const padT = Math.round(4 * dpr);
    const padB = Math.round(4 * dpr);
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
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    for (let i = 1; i < 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
    }
    let maxVal = 1;
    for (let i = 0; i < HIST_BINS; i++) {
      if (binArr[i] > maxVal) {
        maxVal = binArr[i];
      }
    }
    // filled area + stroke
    ctx.beginPath();
    for (let i = 0; i < HIST_BINS; i++) {
      const x = padL + (i / (HIST_BINS - 1)) * plotW;
      const y = padT + plotH - (binArr[i] / maxVal) * plotH;
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
      const y = padT + plotH - (binArr[hoverBin] / maxVal) * plotH;
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
      histMeta.textContent =
        cfg.name +
        ' · ' +
        sampleW +
        '×' +
        sampleH +
        ' samples · ' +
        bins.length +
        ' ch';
    }
    // keep hover if still valid
    if (histHover && histHover.ch >= bins.length) {
      histHover = null;
      hideHistTooltip();
    }
    redrawHistCharts();
    if (histHover) {
      // refresh tooltip counts without needing last mouse event coords
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

  function scheduleHistogram() {
    if (!histogramToggle || !histogramToggle.checked || !isStreaming) {
      return;
    }
    const now = performance.now();
    if (histBusy) {
      histPending = true;
      return;
    }
    if (now - histThrottle < HIST_MIN_MS) {
      histPending = true;
      return;
    }
    histThrottle = now;
    histPending = false;
    updateHistogram();
  }

  function updateHistogram() {
    if (!histogramToggle || !histogramToggle.checked || !isStreaming) {
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
      const wait = Math.max(0, HIST_MIN_MS - (performance.now() - histThrottle));
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
      histThrottle = 0;
      // layout then compute so canvas clientWidth is valid
      requestAnimationFrame(function () {
        scheduleHistogram();
      });
    } else {
      clearHistogram();
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
      scheduleHistogram();
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
    // keep last histogram when stopped
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
      scheduleHistogram();
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
        scheduleHistogram();
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
  overlayToggle.addEventListener('change', updateOverlay);
  if (histogramToggle) {
    histogramToggle.addEventListener('change', onHistToggle);
  }
  if (histSpace) {
    histSpace.addEventListener('change', function () {
      histThrottle = 0;
      scheduleHistogram();
    });
  }
  let histResizeTimer = null;
  window.addEventListener('resize', function () {
    if (!histState) {
      return;
    }
    clearTimeout(histResizeTimer);
    histResizeTimer = setTimeout(function () {
      redrawHistCharts();
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
