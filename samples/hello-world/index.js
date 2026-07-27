const plugin = {
  manifest: {
    id: "sample.hello-world",
    name: "Hello World",
    version: "1.0.0",
    main: "index.js",
    apiVersion: "1.0",
    permissions: ["ui.command", "ui.panel"],
    contributes: {
      commands: [
        {
          id: "sample.hello-world.say",
          title: "Say Hello",
        },
      ],
    },
  },

  activate(host) {
    host.log("Hello World plugin activated");
    let panel;

    this._disposable = host.ui.registerCommand("sample.hello-world.say", () => {
      host.log("Say Hello command triggered");
      if (!panel) {
        panel = host.ui.createPanel({
          viewType: "sampleHelloWorld",
          title: host.ui.t("Hello World"),
          column: "beside",
          html: () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      text-align: center;
      padding: 32px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      background: var(--vscode-editorWidget-background);
    }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { margin: 0; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from MaixCode!</h1>
    <p>Plugin ID: sample.hello-world</p>
  </div>
</body>
</html>`,
        });
        panel.onDidDispose(() => {
          panel = undefined;
        });
      } else {
        panel.reveal("beside");
      }
    });
  },

  deactivate() {
    if (this._disposable) {
      this._disposable.dispose();
      this._disposable = undefined;
    }
  },
};

module.exports = plugin;
