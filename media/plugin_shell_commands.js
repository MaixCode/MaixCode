(function () {
  const vscode = acquireVsCodeApi();
  const presetSelect = document.getElementById("presetSelect");
  const commandInput = document.getElementById("commandInput");
  const runBtn = document.getElementById("runBtn");
  const terminalBtn = document.getElementById("terminalBtn");
  const clearBtn = document.getElementById("clearBtn");
  const output = document.getElementById("output");
  const deviceStatus = document.getElementById("deviceStatus");

  let applyingState = false;

  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  function setBusy(busy, readyText) {
    runBtn.disabled = busy;
    presetSelect.disabled = busy;
    commandInput.readOnly = busy;
    if (busy) {
      runBtn.textContent = "...";
    } else {
      runBtn.textContent = readyText;
    }
  }

  presetSelect.addEventListener("change", () => {
    const option = presetSelect.selectedOptions[0];
    const command = option ? option.dataset.command || "" : "";
    applyingState = true;
    commandInput.value = command;
    applyingState = false;
    post("updateCommand", { command });
  });

  commandInput.addEventListener("input", () => {
    if (applyingState) {
      return;
    }
    post("updateCommand", { command: commandInput.value });
  });

  commandInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      post("run", { command: commandInput.value });
    }
  });

  runBtn.addEventListener("click", () => {
    post("run", { command: commandInput.value });
  });

  terminalBtn.addEventListener("click", () => {
    post("openTerminal");
  });

  clearBtn.addEventListener("click", () => {
    post("clearOutput");
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") {
      return;
    }
    const state = message.state;
    const presets = Array.isArray(message.presets) ? message.presets : [];
    const labels = message.labels || {};

    applyingState = true;
    presetSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "";
    presetSelect.append(defaultOption);
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.command;
      option.textContent = preset.label;
      option.dataset.command = preset.command;
      if (preset.command === state.command) {
        option.selected = true;
      }
      presetSelect.append(option);
    }
    commandInput.value = state.command || "";
    applyingState = false;

    output.textContent = state.output || labels.waiting || "";
    output.scrollTop = output.scrollHeight;
    deviceStatus.textContent = message.hasDevice ? (labels.connected || labels.ready || "") : (labels.waiting || labels.disconnected || "");
    setBusy(Boolean(state.busy), runBtn.dataset.label || runBtn.textContent || "Run");
  });

  runBtn.dataset.label = runBtn.textContent || "Run";
  post("ready");
})();
