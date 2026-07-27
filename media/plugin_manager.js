(function () {
  const vscode = acquireVsCodeApi();
  const pluginList = document.getElementById("pluginList");
  const detailCard = document.getElementById("detailCard");
  const detailBody = document.getElementById("detailBody");
  const detailActions = document.getElementById("detailActions");
  const emptyHint = document.getElementById("emptyHint");
  const importBtn = document.getElementById("importBtn");
  const openFolderBtn = document.getElementById("openFolderBtn");

  let plugins = [];
  let selectedId = "";

  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  function text(value) {
    return value == null ? "" : String(value);
  }

  function renderList() {
    pluginList.innerHTML = "";
    if (!plugins.length) {
      return;
    }
    for (const plugin of plugins) {
      const item = document.createElement("div");
      item.className = `item${plugin.id === selectedId ? " active" : ""}`;
      item.innerHTML = `<div>${text(plugin.name)}</div><div class="meta">${text(plugin.id)} · ${text(plugin.version)} · ${text(plugin.state)}</div>`;
      item.addEventListener("click", () => {
        selectedId = plugin.id;
        render();
      });
      pluginList.append(item);
    }
  }

  function actionButton(label, handler) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderDetail() {
    const plugin = plugins.find((item) => item.id === selectedId);
    if (!plugin) {
      detailCard.hidden = true;
      emptyHint.hidden = false;
      return;
    }
    detailCard.hidden = false;
    emptyHint.hidden = true;
    const labels = (window.__labels = window.__labels || {});
    detailActions.innerHTML = "";
    detailActions.append(
      actionButton(plugin.enabled ? (labels.disable || "Disable") : (labels.enable || "Enable"), () => {
        post(plugin.enabled ? "disable" : "enable", { id: plugin.id });
      }),
      actionButton(labels.reload || "Reload", () => {
        post("reload", { id: plugin.id });
      }),
      actionButton(labels.reveal || "Reveal", () => {
        post("reveal", { id: plugin.id });
      })
    );
    if (!plugin.builtin) {
      detailActions.append(
        actionButton(labels.remove || "Remove", () => {
          post("remove", { id: plugin.id });
        })
      );
    }
    detailBody.innerHTML = "";
    const fields = [
      [labels.name || "Name", plugin.name],
      [labels.id || "ID", plugin.id],
      [labels.version || "Version", plugin.version],
      [labels.source || "Source", plugin.source],
      [labels.state || "State", plugin.state],
      [labels.entry || "Entry", plugin.main],
      [labels.path || "Path", plugin.directoryPath || labels.none || "-"],
      [labels.permissions || "Permissions", Array.isArray(plugin.permissions) ? plugin.permissions.join(", ") : ""],
      [labels.error || "Error", plugin.lastError || labels.none || "-"],
    ];
    for (const [label, value] of fields) {
      const block = document.createElement("div");
      block.className = "card";
      block.innerHTML = `<div class="meta">${text(label)}</div><pre>${escapeHtml(text(value))}</pre>`;
      detailBody.append(block);
    }
    if (Array.isArray(plugin.commands) && plugin.commands.length) {
      const commandsBlock = document.createElement("div");
      commandsBlock.className = "card";
      commandsBlock.innerHTML = `<div class="meta">${labels.commands || "Commands"}</div>`;
      for (const cmd of plugin.commands) {
        const btn = document.createElement("button");
        btn.textContent = cmd.title || cmd.id;
        btn.addEventListener("click", () => post("runCommand", { id: plugin.id, commandId: cmd.id }));
        commandsBlock.append(btn);
      }
      detailBody.append(commandsBlock);
    }
  }

  function render() {
    if (!selectedId && plugins.length) {
      selectedId = plugins[0].id;
    }
    if (selectedId && !plugins.some((plugin) => plugin.id === selectedId)) {
      selectedId = plugins[0] ? plugins[0].id : "";
    }
    renderList();
    renderDetail();
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  importBtn.addEventListener("click", () => post("import"));
  openFolderBtn.addEventListener("click", () => post("reveal"));

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") {
      return;
    }
    plugins = Array.isArray(message.plugins) ? message.plugins : [];
    window.__labels = message.labels || {};
    render();
  });

  post("ready");
})();
