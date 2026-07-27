(function () {
  const vscode = acquireVsCodeApi();
  const title = document.getElementById("title");
  const subtitle = document.getElementById("subtitle");
  const device = document.getElementById("device");
  const refreshBtn = document.getElementById("refreshBtn");
  const terminalBtn = document.getElementById("terminalBtn");
  const clearBtn = document.getElementById("clearBtn");
  const hint = document.getElementById("hint");
  const output = document.getElementById("output");

  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  refreshBtn.addEventListener("click", () => post("refresh"));
  terminalBtn.addEventListener("click", () => post("terminal"));
  clearBtn.addEventListener("click", () => {
    output.textContent = "";
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") {
      return;
    }
    const labels = message.labels || {};
    const state = message.state || {};
    title.textContent = labels.title || "Device Process List";
    subtitle.textContent = labels.subtitle || "";
    device.textContent = state.deviceName || labels.noDevice || "";
    refreshBtn.textContent = labels.refresh || "Refresh";
    terminalBtn.textContent = labels.openTerminal || "Open SSH Terminal";
    clearBtn.textContent = labels.clear || "Clear";
    hint.textContent = state.busy ? labels.waiting || "" : labels.waiting || "";
    output.textContent = state.output || "";
  });

  post("ready");
})();
