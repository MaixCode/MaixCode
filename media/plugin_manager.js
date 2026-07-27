(function () {
  const vscode = acquireVsCodeApi();
  const pluginList = document.getElementById("pluginList");
  const marketplaceList = document.getElementById("marketplaceList");
  const detailCard = document.getElementById("detailCard");
  const detailBody = document.getElementById("detailBody");
  const detailActions = document.getElementById("detailActions");
  const detailTitle = document.getElementById("detailTitle");
  const detailSub = document.getElementById("detailSub");
  const emptyHint = document.getElementById("emptyHint");
  const listCount = document.getElementById("listCount");
  const importBtn = document.getElementById("importBtn");
  const openFolderBtn = document.getElementById("openFolderBtn");
  const refreshMarketplaceBtn = document.getElementById("refreshMarketplaceBtn");
  const searchInput = document.getElementById("searchInput");
  const searchWrap = document.getElementById("searchWrap");
  const tabs = document.querySelectorAll(".tab");

  let state = {
    tab: "installed",
    plugins: [],
    marketplace: [],
    marketplaceConfigured: false,
    updateIds: [],
    labels: {},
  };
  let selectedId = "";

  function post(type, extra) {
    vscode.postMessage(Object.assign({ type }, extra || {}));
  }

  function text(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function L(key, fallback) {
    return state.labels[key] || fallback;
  }

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => render(), 120);
  });

  function query() {
    return searchInput.value.toLowerCase().trim();
  }

  function matchesQuery(name, id, q) {
    if (!q) return true;
    return text(name).toLowerCase().includes(q) || text(id).toLowerCase().includes(q);
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      post("switchTab", { tab: tab.dataset.tab });
    });
  }

  function renderTabs() {
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.dataset.tab === state.tab);
    }
  }

  function updateHeader() {
    const installed = state.tab === "installed";
    importBtn.classList.toggle("hidden", !installed);
    importBtn.textContent = L("importPlugin", "Import Plugin");
    openFolderBtn.classList.toggle("hidden", !installed);
    openFolderBtn.textContent = L("openFolder", "Open Plugin Folder");
    refreshMarketplaceBtn.classList.toggle("hidden", installed);
    refreshMarketplaceBtn.textContent = L("refresh", "Refresh");
    searchWrap.classList.toggle("hidden", false);
    searchInput.placeholder = L("searchHint", "Search plugins...");
  }

  function badge(cls, label) {
    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
  }

  function actionButton(label, handler, options) {
    const button = document.createElement("button");
    button.textContent = label;
    if (options && options.secondary) button.classList.add("secondary");
    if (options && options.danger) button.classList.add("danger");
    if (options && options.disabled) button.disabled = true;
    if (handler && !(options && options.disabled)) {
      button.addEventListener("click", handler);
    }
    return button;
  }

  function field(label, value, wide) {
    const block = document.createElement("div");
    block.className = wide ? "field wide" : "field";
    block.innerHTML =
      `<div class="field-label">${escapeHtml(label)}</div>` +
      `<pre class="field-value">${escapeHtml(text(value))}</pre>`;
    return block;
  }

  function dedupeById(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function stateLabel(plugin) {
    if (plugin.state === "error") return L("errorState", "Error");
    if (plugin.state === "disabled" || !plugin.enabled) return L("disabled", "Disabled");
    if (plugin.state === "active" || plugin.active) return L("active", "Active");
    return L("inactive", "Inactive");
  }

  function renderInstalledList() {
    pluginList.classList.remove("hidden");
    marketplaceList.classList.add("hidden");
    pluginList.innerHTML = "";

    const q = query();
    const items = state.plugins
      .filter((p) => matchesQuery(p.name, p.id, q))
      .slice()
      .sort((a, b) => text(a.name).localeCompare(text(b.name)));

    listCount.textContent = (L("count", "{0} plugins") || "{0} plugins").replace("{0}", String(items.length));

    if (!state.plugins.length) {
      pluginList.innerHTML = `<div class="hint">${escapeHtml(L("empty", "No plugins installed yet."))}</div>`;
      return items;
    }
    if (!items.length) {
      pluginList.innerHTML = `<div class="hint">${escapeHtml(L("searchNoResults", "No plugins match your search."))}</div>`;
      return items;
    }

    for (const plugin of items) {
      const el = document.createElement("div");
      el.className = `item${plugin.id === selectedId ? " active" : ""}`;
      const badges = [];
      if (plugin.builtin) badges.push(badge("builtin", L("builtin", "Built-in")));
      else badges.push(badge("", L("local", "Local")));
      if (plugin.state === "error") badges.push(badge("error", L("errorState", "Error")));
      else if (plugin.state === "disabled" || !plugin.enabled) badges.push(badge("disabled", L("disabled", "Disabled")));
      else if (plugin.active || plugin.state === "active") badges.push(badge("active", L("active", "Active")));
      el.innerHTML =
        `<div class="item-title"><span>${escapeHtml(plugin.name)}</span><div class="badges">${badges.join("")}</div></div>` +
        `<div class="item-meta">${escapeHtml(plugin.id)} · v${escapeHtml(plugin.version)} · ${escapeHtml(stateLabel(plugin))}</div>`;
      el.addEventListener("click", () => {
        selectedId = plugin.id;
        render();
      });
      pluginList.append(el);
    }
    return items;
  }

  function renderInstalledDetail() {
    const plugin = state.plugins.find((item) => item.id === selectedId);
    if (!plugin) {
      detailCard.hidden = true;
      emptyHint.hidden = false;
      emptyHint.textContent = L("selectHint", "Select a plugin to inspect and manage.");
      detailTitle.textContent = L("details", "Plugin Details");
      detailSub.textContent = "";
      return;
    }
    detailCard.hidden = false;
    emptyHint.hidden = true;
    detailTitle.textContent = plugin.name;
    detailSub.textContent = `${plugin.id} · v${plugin.version}`;
    detailActions.innerHTML = "";
    detailActions.append(
      actionButton(plugin.enabled ? L("disable", "Disable") : L("enable", "Enable"), () => {
        post(plugin.enabled ? "disable" : "enable", { id: plugin.id });
      }),
      actionButton(L("reload", "Reload"), () => post("reload", { id: plugin.id }), { secondary: true }),
      actionButton(L("reveal", "Reveal"), () => post("reveal", { id: plugin.id }), { secondary: true })
    );
    if (!plugin.builtin) {
      detailActions.append(
        actionButton(L("remove", "Remove"), () => post("remove", { id: plugin.id }), { danger: true })
      );
    }

    detailBody.innerHTML = "";
    const fields = [
      [L("name", "Name"), plugin.name],
      [L("id", "ID"), plugin.id],
      [L("version", "Version"), plugin.version],
      [L("source", "Source"), plugin.builtin ? L("builtin", "Built-in") : plugin.source || L("local", "Local")],
      [L("state", "State"), stateLabel(plugin)],
      [L("entry", "Entry"), plugin.main || L("none", "-")],
      [L("path", "Path"), plugin.directoryPath || L("none", "-"), true],
      [L("permissions", "Permissions"), Array.isArray(plugin.permissions) ? plugin.permissions.join(", ") : "", true],
      [L("error", "Error"), plugin.lastError || L("none", "-"), true],
    ];
    for (const [label, value, wide] of fields) {
      detailBody.append(field(label, value, wide));
    }
    if (Array.isArray(plugin.commands) && plugin.commands.length) {
      const wrap = document.createElement("div");
      wrap.className = "field wide";
      wrap.innerHTML = `<div class="field-label">${escapeHtml(L("commands", "Commands"))}</div>`;
      const cmds = document.createElement("div");
      cmds.className = "commands";
      for (const cmd of plugin.commands) {
        cmds.append(
          actionButton(cmd.title || cmd.id, () => post("runCommand", { id: plugin.id, commandId: cmd.id }), {
            secondary: true,
          })
        );
      }
      wrap.append(cmds);
      detailBody.append(wrap);
    }
  }

  function marketplaceItems() {
    const unique = dedupeById(state.marketplace || []);
    const q = query();
    return unique
      .filter((entry) => matchesQuery(entry.name, entry.id, q))
      .slice()
      .sort((a, b) => {
        if (!!a.isLocal !== !!b.isLocal) return a.isLocal ? 1 : -1;
        return text(a.name).localeCompare(text(b.name));
      });
  }

  function renderMarketplaceList() {
    pluginList.classList.add("hidden");
    marketplaceList.classList.remove("hidden");
    marketplaceList.innerHTML = "";

    const unique = dedupeById(state.marketplace || []);
    if (!unique.length) {
      listCount.textContent = (L("count", "{0} plugins") || "{0} plugins").replace("{0}", "0");
      marketplaceList.innerHTML = state.marketplaceConfigured
        ? `<div class="hint">${escapeHtml(L("marketplaceLoading", "Click Refresh to load available plugins."))}</div>`
        : `<div class="hint">${escapeHtml(L("marketplaceEmpty", "No marketplace configured. Add sources in MaixCode settings."))}</div>`;
      return [];
    }

    const items = marketplaceItems();
    listCount.textContent = (L("count", "{0} plugins") || "{0} plugins").replace("{0}", String(items.length));
    if (!items.length) {
      marketplaceList.innerHTML = `<div class="hint">${escapeHtml(L("searchNoResults", "No plugins match your search."))}</div>`;
      return items;
    }

    const updateIds = new Set(state.updateIds || []);
    let lastGroup = null;
    for (const entry of items) {
      const group = entry.isLocal ? "local" : "marketplace";
      if (group !== lastGroup) {
        lastGroup = group;
        const label = document.createElement("div");
        label.className = "section-label";
        label.textContent = entry.isLocal
          ? L("localSection", "Local Plugins")
          : L("marketplaceSection", "Marketplace");
        marketplaceList.append(label);
      }

      const el = document.createElement("div");
      el.className = `item${entry.id === selectedId ? " active" : ""}`;
      const badges = [];
      if (updateIds.has(entry.id)) badges.push(badge("update", L("update", "Update")));
      else if (entry.installed) badges.push(badge("installed", L("installed", "Installed")));
      el.innerHTML =
        `<div class="item-title"><span>${escapeHtml(entry.name)}</span><div class="badges">${badges.join("")}</div></div>` +
        `<div class="item-meta">${escapeHtml(entry.sourceLabel || "")} · ${escapeHtml(entry.id)} · v${escapeHtml(entry.version)}${
          entry.author ? " · " + escapeHtml(entry.author) : ""
        }</div>`;
      el.addEventListener("click", () => {
        selectedId = entry.id;
        render();
      });
      marketplaceList.append(el);
    }
    return items;
  }

  function renderMarketplaceDetail() {
    const entry = dedupeById(state.marketplace || []).find((item) => item.id === selectedId);
    if (!entry) {
      detailCard.hidden = true;
      emptyHint.hidden = false;
      emptyHint.textContent = L("selectHint", "Select a plugin to inspect and manage.");
      detailTitle.textContent = L("marketplaceTab", "Marketplace");
      detailSub.textContent = "";
      return;
    }

    detailCard.hidden = false;
    emptyHint.hidden = true;
    detailTitle.textContent = entry.name;
    detailSub.textContent = `${entry.id} · v${entry.version}`;
    detailActions.innerHTML = "";

    const updateIds = new Set(state.updateIds || []);
    const hasUpdate = updateIds.has(entry.id);
    if (entry.isLocal) {
      detailActions.append(
        actionButton(L("installed", "Installed"), null, { disabled: true, secondary: true })
      );
    } else if (!entry.installed) {
      detailActions.append(
        actionButton(L("install", "Install"), () => post("installMarketplace", { id: entry.id }))
      );
    } else if (hasUpdate) {
      detailActions.append(
        actionButton(L("update", "Update"), () => post("installMarketplace", { id: entry.id }))
      );
    } else {
      detailActions.append(
        actionButton(L("reinstall", "Reinstall"), () => post("installMarketplace", { id: entry.id }), {
          secondary: true,
        })
      );
    }

    detailBody.innerHTML = "";
    const fields = [
      [L("name", "Name"), entry.name],
      [L("id", "ID"), entry.id],
      [L("version", "Version"), entry.version],
      entry.installed ? [L("installedVersion", "Installed Version"), entry.installedVersion || ""] : null,
      [L("source", "Source"), entry.sourceLabel || ""],
      [L("description", "Description"), entry.description || L("none", "-"), true],
      [L("author", "Author"), entry.author || L("none", "-")],
      [
        L("permissions", "Permissions"),
        Array.isArray(entry.permissions) && entry.permissions.length
          ? entry.permissions.join(", ")
          : L("none", "-"),
        true,
      ],
    ].filter(Boolean);
    for (const [label, value, wide] of fields) {
      detailBody.append(field(label, value, wide));
    }
  }

  function ensureSelection(list) {
    if (!list.length) {
      selectedId = "";
      return;
    }
    if (!selectedId || !list.some((item) => item.id === selectedId)) {
      selectedId = list[0].id;
    }
  }

  function render() {
    renderTabs();
    updateHeader();
    if (state.tab === "installed") {
      const items = renderInstalledList();
      ensureSelection(items.length ? items : state.plugins);
      if (items.length && selectedId && !items.some((p) => p.id === selectedId)) {
        selectedId = items[0].id;
      }
      renderInstalledDetail();
    } else {
      const items = renderMarketplaceList();
      ensureSelection(items);
      renderMarketplaceDetail();
    }
  }

  importBtn.addEventListener("click", () => post("import"));
  openFolderBtn.addEventListener("click", () => post("reveal"));
  refreshMarketplaceBtn.addEventListener("click", () => post("refreshMarketplace"));

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "state") return;
    state = {
      tab: message.tab || "installed",
      plugins: Array.isArray(message.plugins) ? message.plugins : [],
      marketplace: Array.isArray(message.marketplace) ? message.marketplace : [],
      marketplaceConfigured: !!message.marketplaceConfigured,
      updateIds: Array.isArray(message.updateIds) ? message.updateIds : [],
      labels: message.labels || {},
    };
    render();
  });

  post("ready");
})();
