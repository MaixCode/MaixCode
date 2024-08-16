import * as vscode from "vscode";

export class SecondarySidebar {
  private sidebar: vscode.WebviewPanel | undefined;

  constructor(context: vscode.ExtensionContext) {
    // this.sidebar = vscode.window.createWebviewPanel(
    //   "secondarySidebar",
    //   "Secondary Sidebar",
    //   vscode.ViewColumn.Two,
    //   {
    //     enableScripts: true,
    //   }
    // );

    // this.sidebar.webview.html = this.getWebviewContent();
    // 注册 WebviewViewProvider 到 secondary sidebar
    let provider = new SecondarySidebarWebviewProvider();
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("maixcode-tool", provider)
    );
  }
}

class SecondarySidebarWebviewProvider implements vscode.WebviewViewProvider {
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getWebviewContent();
  }

  private getWebviewContent() {
    return `
      <html>
        <head></head>
        <body>
          <img src="https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif" />
        </body>
      </html>`;
  }
}
