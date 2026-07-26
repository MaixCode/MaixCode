(function () {
  const vscode = acquireVsCodeApi();
  const modeSelect = document.getElementById("modeSelect");
  const rangesRoot = document.getElementById("ranges");
  const sourceImage = document.getElementById("sourceImage");
  const maskCanvas = document.getElementById("maskCanvas");
  const exportBtn = document.getElementById("exportBtn");
  const emptyState = document.getElementById("emptyState");
  const maskCtx = maskCanvas.getContext("2d");
  const workCanvas = document.createElement("canvas");
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

  let state = {
    mode: "hsv",
    ranges: [0, 255, 0, 255, 0, 255],
  };

  const channelLabels = {
    hsv: ["H", "S", "V"],
    lab: ["L", "A", "B"],
  };

  function setEmptyState(text) {
    const visible = Boolean(text);
    emptyState.textContent = text || "";
    emptyState.style.display = visible ? "block" : "none";
    sourceImage.style.display = visible ? "none" : "block";
    maskCanvas.style.display = visible ? "none" : "block";
  }

  function renderControls() {
    const labels = channelLabels[state.mode];
    rangesRoot.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const minIndex = i * 2;
      const maxIndex = minIndex + 1;
      const row = document.createElement("div");
      row.className = "pair";
      const label = document.createElement("label");
      label.textContent = labels[i];
      const min = document.createElement("input");
      min.type = "range";
      min.min = "0";
      min.max = "255";
      min.value = String(state.ranges[minIndex]);
      const minBox = document.createElement("input");
      minBox.type = "number";
      minBox.min = "0";
      minBox.max = "255";
      minBox.value = String(state.ranges[minIndex]);
      const max = document.createElement("input");
      max.type = "range";
      max.min = "0";
      max.max = "255";
      max.value = String(state.ranges[maxIndex]);
      const maxBox = document.createElement("input");
      maxBox.type = "number";
      maxBox.min = "0";
      maxBox.max = "255";
      maxBox.value = String(state.ranges[maxIndex]);
      const sync = (index, value) => {
        state.ranges[index] = clamp(Number(value));
        min.value = String(state.ranges[minIndex]);
        minBox.value = String(state.ranges[minIndex]);
        max.value = String(state.ranges[maxIndex]);
        maxBox.value = String(state.ranges[maxIndex]);
        if (state.ranges[minIndex] > state.ranges[maxIndex]) {
          state.ranges[maxIndex] = state.ranges[minIndex];
          max.value = String(state.ranges[maxIndex]);
          maxBox.value = String(state.ranges[maxIndex]);
        }
        postUpdate();
        drawMask();
      };
      min.addEventListener("input", () => sync(minIndex, min.value));
      minBox.addEventListener("change", () => sync(minIndex, minBox.value));
      max.addEventListener("input", () => sync(maxIndex, max.value));
      maxBox.addEventListener("change", () => sync(maxIndex, maxBox.value));

      const left = document.createElement("div");
      left.append(label, min, minBox);
      left.style.display = "contents";
      const right = document.createElement("div");
      right.style.display = "contents";
      right.append(document.createTextNode(""), max, maxBox);
      row.append(left, right);
      rangesRoot.append(row);
    }
  }

  function clamp(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function postUpdate() {
    vscode.postMessage({
      type: "update",
      mode: state.mode,
      ranges: state.ranges,
    });
  }

  function drawMask() {
    if (!sourceImage.naturalWidth || !sourceImage.naturalHeight) {
      return;
    }
    workCanvas.width = sourceImage.naturalWidth;
    workCanvas.height = sourceImage.naturalHeight;
    maskCanvas.width = sourceImage.naturalWidth;
    maskCanvas.height = sourceImage.naturalHeight;
    workCtx.drawImage(sourceImage, 0, 0);
    const imageData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
    const src = imageData.data;
    const out = maskCtx.createImageData(workCanvas.width, workCanvas.height);
    const dst = out.data;
    for (let i = 0; i < src.length; i += 4) {
      const c = state.mode === "hsv" ? rgbToHsv(src[i], src[i + 1], src[i + 2]) : rgbToLab(src[i], src[i + 1], src[i + 2]);
      const hit = inRange(c[0], 0) && inRange(c[1], 2) && inRange(c[2], 4);
      const value = hit ? 255 : 0;
      dst[i] = value;
      dst[i + 1] = value;
      dst[i + 2] = value;
      dst[i + 3] = 255;
    }
    maskCtx.putImageData(out, 0, 0);
  }

  function inRange(value, start) {
    return value >= state.ranges[start] && value <= state.ranges[start + 1];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    h = Math.round((((h * 60) + 360) % 360) / 360 * 255);
    const s = Math.round((max === 0 ? 0 : d / max) * 255);
    const v = Math.round(max * 255);
    return [h, s, v];
  }

  function rgbToLab(r, g, b) {
    let [x, y, z] = rgbToXyz(r, g, b);
    x /= 95.047; y /= 100; z /= 108.883;
    x = xyzPivot(x); y = xyzPivot(y); z = xyzPivot(z);
    const l = Math.round((116 * y - 16) / 100 * 255);
    const a = Math.round((500 * (x - y) + 128));
    const bb = Math.round((200 * (y - z) + 128));
    return [clamp(l), clamp(a), clamp(bb)];
  }

  function rgbToXyz(r, g, b) {
    r = rgbPivot(r / 255); g = rgbPivot(g / 255); b = rgbPivot(b / 255);
    return [
      (r * 0.4124 + g * 0.3576 + b * 0.1805) * 100,
      (r * 0.2126 + g * 0.7152 + b * 0.0722) * 100,
      (r * 0.0193 + g * 0.1192 + b * 0.9505) * 100,
    ];
  }

  function rgbPivot(v) {
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  }

  function xyzPivot(v) {
    return v > 0.008856 ? Math.cbrt(v) : (7.787 * v) + (16 / 116);
  }

  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    renderControls();
    postUpdate();
    drawMask();
  });

  exportBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "export" });
  });

  sourceImage.addEventListener("load", drawMask);

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "init") {
      state = message.state;
      modeSelect.value = state.mode;
      renderControls();
      if (message.imageBase64) {
        setEmptyState("");
        sourceImage.src = `data:image/jpeg;base64,${message.imageBase64}`;
      } else {
        setEmptyState(message.emptyText || "");
      }
      return;
    }
    if (message.type === "frame" && message.imageBase64) {
      setEmptyState("");
      sourceImage.src = `data:image/jpeg;base64,${message.imageBase64}`;
    }
  });

  renderControls();
  vscode.postMessage({ type: "ready" });
})();
