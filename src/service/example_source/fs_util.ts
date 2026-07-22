import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function emptyDir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  await fs.promises.rm(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

export async function copyDir(src: string, dest: string): Promise<void> {
  ensureDir(dest);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(s, d);
    } else if (ent.isFile()) {
      await fs.promises.copyFile(s, d);
    }
  }
}

export async function extractZipTo(
  zipContent: JSZip,
  extractPath: string
): Promise<void> {
  ensureDir(extractPath);
  const files = Object.keys(zipContent.files);
  await Promise.all(
    files.map(async (fileName) => {
      const file = zipContent.files[fileName];
      const filePath = path.join(extractPath, fileName);
      if (file.dir) {
        ensureDir(filePath);
      } else {
        ensureDir(path.dirname(filePath));
        const content = await file.async("nodebuffer");
        await fs.promises.writeFile(filePath, content);
      }
    })
  );
}

export function buildFileTree(dir: string): Record<string, any> {
  const result: Record<string, any> = {};
  if (!fs.existsSync(dir)) {
    return result;
  }
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.startsWith(".")) {
      continue;
    }
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      result[file] = buildFileTree(filePath);
    } else {
      result[file] = null;
    }
  }
  return result;
}
