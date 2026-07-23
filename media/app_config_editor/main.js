(function () {
  const vscode = acquireVsCodeApi();

  const projectLabel = document.getElementById("projectLabel");
  const statusBar = document.getElementById("statusBar");
  const autoSaveBadge = document.getElementById("autoSaveBadge");
  const fieldId = document.getElementById("fieldId");
  const fieldName = document.getElementById("fieldName");
  const fieldVersion = document.getElementById("fieldVersion");
  const fieldAuthor = document.getElementById("fieldAuthor");
  const fieldDesc = document.getElementById("fieldDesc");
  const fieldIcon = document.getElementById("fieldIcon");
  const iconImg = document.getElementById("iconImg");
  const iconPlaceholder = document.getElementById("iconPlaceholder");
  const fileList = document.getElementById("fileList");
  const fileFilter = document.getElementById("fileFilter");
  const filesCount = document.getElementById("filesCount");
  const saveBtn = document.getElementById("saveBtn");
  const reloadBtn = document.getElementById("reloadBtn");
  const openYamlBtn = document.getElementById("openYamlBtn");
  const browseIconBtn = document.getElementById("browseIconBtn");
  const selectPyBtn = document.getElementById("selectPyBtn");
  const clearFilesBtn = document.getElementById("clearFilesBtn");

  let projectDir = "";
  let projectFiles = [];
  /** @type {Set<string>} */
  let selected = new Set();
  let autoSaveEnabled = true;
  let applying = false;
  let autoSaveTimer = null;
  const AUTO_SAVE_MS = 600;

  const selectedWord =
    (filesCount && filesCount.textContent && filesCount.textContent.replace(/^\d+\s*/, "")) ||
    "selected";

  function setStatus(kind, message) {
    if (!statusBar) {
      return;
    }
    if (!message) {
      statusBar.hidden = true;
      statusBar.textContent = "";
      statusBar.className = "status";
      return;
    }
    statusBar.hidden = false;
    statusBar.textContent = message;
    statusBar.className = "status " + (kind === "ok" ? "ok" : kind === "busy" ? "busy" : "err");
  }

  function setBadge(state) {
    if (!autoSaveBadge) {
      return;
    }
    autoSaveBadge.classList.remove("saving", "saved", "error");
    if (state) {
      autoSaveBadge.classList.add(state);
    }
  }

  function setIconPreview(dataUrl) {
    if (!iconImg || !iconPlaceholder) {
      return;
    }
    if (dataUrl) {
      iconImg.src = dataUrl;
      iconImg.hidden = false;
      iconPlaceholder.hidden = true;
    } else {
      iconImg.removeAttribute("src");
      iconImg.hidden = true;
      iconPlaceholder.hidden = false;
    }
  }

  function updateCount() {
    if (filesCount) {
      filesCount.textContent = selected.size + " " + selectedWord;
    }
  }

  function scheduleAutoSave() {
    if (!autoSaveEnabled || applying) {
      return;
    }
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    setBadge("saving");
    setStatus("busy", "Saving…");
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      vscode.postMessage({ type: "save", config: collectConfig(), silent: true });
    }, AUTO_SAVE_MS);
  }

  function renderFiles() {
    if (!fileList) {
      return;
    }
    const q = (fileFilter && fileFilter.value ? fileFilter.value : "")
      .trim()
      .toLowerCase();
    const visible = q
      ? projectFiles.filter((f) => f.toLowerCase().includes(q))
      : projectFiles.slice();

    fileList.innerHTML = "";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = q ? "No matches" : "No project files found";
      fileList.appendChild(empty);
      updateCount();
      return;
    }

    const frag = document.createDocumentFragment();
    for (const rel of visible) {
      const row = document.createElement("label");
      row.className = "file-item" + (selected.has(rel) ? " selected" : "");
      if (rel === "main.py" || rel.endsWith("/main.py")) {
        row.classList.add("mainpy");
      }
      row.setAttribute("role", "listitem");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(rel);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          selected.add(rel);
          row.classList.add("selected");
        } else {
          selected.delete(rel);
          row.classList.remove("selected");
        }
        updateCount();
        scheduleAutoSave();
      });

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = rel;
      name.title = rel;

      row.appendChild(cb);
      row.appendChild(name);
      frag.appendChild(row);
    }
    fileList.appendChild(frag);
    updateCount();
  }

  function applyConfig(config) {
    if (!config) {
      return;
    }
    applying = true;
    fieldId.value = config.id || "";
    fieldName.value = config.name || "";
    fieldVersion.value = config.version || "";
    fieldAuthor.value = config.author || "";
    fieldDesc.value = config.desc || "";
    fieldIcon.value = config.icon || "";
    selected = new Set(Array.isArray(config.files) ? config.files : []);
    renderFiles();
    applying = false;
  }

  function collectConfig() {
    return {
      id: fieldId.value,
      name: fieldName.value,
      version: fieldVersion.value,
      author: fieldAuthor.value,
      desc: fieldDesc.value,
      icon: fieldIcon.value,
      files: Array.from(selected),
    };
  }

  [fieldId, fieldName, fieldVersion, fieldAuthor, fieldDesc, fieldIcon].forEach(
    (el) => {
      if (el) {
        el.addEventListener("input", () => scheduleAutoSave());
      }
    }
  );

  if (fileFilter) {
    fileFilter.addEventListener("input", () => renderFiles());
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      setStatus(null, "");
      setBadge("saving");
      saveBtn.disabled = true;
      vscode.postMessage({ type: "save", config: collectConfig(), silent: false });
      setTimeout(() => {
        saveBtn.disabled = false;
      }, 400);
    });
  }

  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }
      setStatus(null, "");
      vscode.postMessage({ type: "reload" });
    });
  }

  if (openYamlBtn) {
    openYamlBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "openYaml" });
    });
  }

  if (browseIconBtn) {
    browseIconBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "browseIcon" });
    });
  }

  if (selectPyBtn) {
    selectPyBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "selectAllPy" });
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener("click", () => {
      selected = new Set();
      renderFiles();
      scheduleAutoSave();
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data || {};
    switch (msg.type) {
      case "init": {
        if (autoSaveTimer) {
          clearTimeout(autoSaveTimer);
          autoSaveTimer = null;
        }
        projectDir = msg.projectDir || "";
        autoSaveEnabled = msg.autoSave !== false;
        if (projectLabel) {
          const name = msg.projectName || "";
          projectLabel.textContent = name
            ? name + " — " + projectDir
            : projectDir || "—";
          projectLabel.title = projectDir;
        }
        projectFiles = Array.isArray(msg.projectFiles) ? msg.projectFiles : [];
        applyConfig(msg.config);
        setIconPreview(msg.iconPreview);
        setBadge("");
        if (msg.fromDisk) {
          setStatus("ok", "Reloaded from app.yaml");
        } else if (msg.yamlExists === false) {
          setStatus("ok", "New project — edits auto-save to app.yaml");
        } else {
          setStatus(null, "");
        }
        break;
      }
      case "saveResult": {
        if (msg.ok) {
          if (msg.config && !msg.skipped) {
            // Keep selection/fields; only update if host normalized values
            applying = true;
            if (msg.config.id !== undefined) {
              fieldId.value = msg.config.id;
            }
            if (msg.config.name !== undefined) {
              fieldName.value = msg.config.name;
            }
            if (msg.config.version !== undefined) {
              fieldVersion.value = msg.config.version;
            }
            applying = false;
          }
          setBadge("saved");
          if (msg.skipped) {
            setStatus(null, "");
          } else if (msg.silent) {
            setStatus("ok", msg.message || "Auto-saved");
          } else {
            setStatus("ok", msg.message || "Saved");
          }
        } else {
          setBadge("error");
          // Auto-save validation errors stay quiet in badge; show status line
          setStatus("err", msg.message || "Save failed");
        }
        break;
      }
      case "iconPicked": {
        applying = true;
        if (typeof msg.icon === "string") {
          fieldIcon.value = msg.icon;
        }
        applying = false;
        setIconPreview(msg.iconPreview);
        scheduleAutoSave();
        break;
      }
      case "setFiles": {
        selected = new Set(Array.isArray(msg.files) ? msg.files : []);
        renderFiles();
        scheduleAutoSave();
        break;
      }
      case "error": {
        setBadge("error");
        setStatus("err", msg.message || "Error");
        break;
      }
      default:
        break;
    }
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      if (saveBtn) {
        saveBtn.click();
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
