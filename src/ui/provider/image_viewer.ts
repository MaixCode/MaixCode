import * as vscode from "vscode";
import { ImageType } from "../../model/image_type";

export class ImageViewer {
  private imagePanel: vscode.WebviewPanel | undefined;
  private imageType: ImageType = ImageType.JPEG;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public showWindow(): void {
    if (!this.imagePanel) {
      this.imagePanel = vscode.window.createWebviewPanel(
        "imagePreview",
        "Real-time Image Preview",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [this.context.extensionUri],
        }
      );

      this.imagePanel.onDidDispose(() => {
        this.imagePanel = undefined;
      });
    }

    this.imagePanel.webview.html = this.getWebviewContent("");
  }

  public updateImage(imageData: Buffer): void {
    if (this.imagePanel) {
      this.imagePanel.webview.html = this.getWebviewContent(
        imageData.toString("base64")
      );
    }
  }

  public setImageType(imageType: ImageType): void {
    this.imageType = imageType;
  }

  private getWebviewContent(imageData: string): string {
    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Real-time Image Preview</title>
            </head>
            <body>
                <img src="data:image/${this.imageType
                  .toString()
                  .toLowerCase()};base64,${imageData}" style="max-width: 100%; height: auto;" />
            </body>
            </html>`;
  }
}
