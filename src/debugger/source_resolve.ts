import * as vscode from "vscode";
import * as path from "path";
import { log } from "../logger";

export type ResolvedSource = {
  /** Path used for logging / display */
  label: string;
  /** Prefer reading this absolute filesystem path when set */
  fsPath?: string;
  /** Inline content when no stable fs path (untitled / virtual doc) */
  content?: string;
};

/**
 * Resolve what to run from a debug program string and/or the active editor.
 * Handles:
 * - absolute paths
 * - relative paths (workspace folders)
 * - example: virtual docs (real path in query)
 * - untitled / in-memory documents
 */
export function resolveSourceForRun(program?: string): ResolvedSource {
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;

  // 1) Prefer active editor when it matches the program basename or program is relative/short
  if (doc) {
    const fromEditor = resolveFromDocument(doc, program);
    if (fromEditor) {
      log(
        `[source_resolve] from editor scheme=${doc.uri.scheme} label=${fromEditor.label} fsPath=${fromEditor.fsPath ?? "-"} content=${fromEditor.content ? fromEditor.content.length + "chars" : "-"}`
      );
      return fromEditor;
    }
  }

  // 2) program alone
  if (program) {
    const fromProgram = resolveFromProgramString(program);
    log(
      `[source_resolve] from program label=${fromProgram.label} fsPath=${fromProgram.fsPath ?? "-"}`
    );
    return fromProgram;
  }

  throw new Error("No program path and no active editor");
}

function resolveFromDocument(
  doc: vscode.TextDocument,
  program?: string
): ResolvedSource | undefined {
  const uri = doc.uri;

  // example:hello_maix.py?<encoded absolute path>
  if (uri.scheme === "example") {
    const realPath = uri.query ? decodeURIComponent(uri.query) : undefined;
    const base = path.basename(uri.path || program || "example.py");
    if (realPath && path.isAbsolute(realPath)) {
      // Still use editor text so unsaved virtual content works
      return {
        label: realPath,
        fsPath: realPath,
        content: doc.getText(),
      };
    }
    return {
      label: base,
      content: doc.getText(),
    };
  }

  if (uri.scheme === "untitled") {
    return {
      label: uri.path || "untitled.py",
      content: doc.getText(),
    };
  }

  if (uri.scheme === "file") {
    const fsPath = uri.fsPath;
    // If program is only a basename, accept when it matches this file
    if (
      !program ||
      path.basename(fsPath) === path.basename(program) ||
      fsPath === program ||
      path.normalize(fsPath) === path.normalize(program)
    ) {
      return {
        label: fsPath,
        fsPath,
        content: doc.isDirty ? doc.getText() : undefined,
      };
    }
  }

  // Active editor exists but program points elsewhere — fall through
  if (program && path.isAbsolute(program)) {
    return undefined;
  }

  // Relative program with active non-file doc: use doc content
  if (doc.getText().length > 0 && (!program || path.basename(program) === path.basename(uri.path))) {
    return {
      label: uri.toString(),
      content: doc.getText(),
    };
  }

  return undefined;
}

function resolveFromProgramString(program: string): ResolvedSource {
  if (path.isAbsolute(program)) {
    return { label: program, fsPath: program };
  }

  // Workspace-relative
  const folders = vscode.workspace.workspaceFolders;
  if (folders) {
    for (const folder of folders) {
      const candidate = path.join(folder.uri.fsPath, program);
      return { label: candidate, fsPath: candidate };
    }
  }

  // Basename only — search open text documents
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === "example" && doc.uri.query) {
      const real = decodeURIComponent(doc.uri.query);
      if (path.basename(real) === path.basename(program) || path.basename(doc.uri.path) === path.basename(program)) {
        return {
          label: real,
          fsPath: path.isAbsolute(real) ? real : undefined,
          content: doc.getText(),
        };
      }
    }
    if (doc.uri.scheme === "file" && path.basename(doc.uri.fsPath) === path.basename(program)) {
      return {
        label: doc.uri.fsPath,
        fsPath: doc.uri.fsPath,
        content: doc.isDirty ? doc.getText() : undefined,
      };
    }
  }

  // Last resort: treat as relative to cwd (will likely fail; caller logs)
  const cwdPath = path.resolve(program);
  return { label: cwdPath, fsPath: cwdPath };
}

export async function readResolvedSource(
  source: ResolvedSource,
  readFile: (fsPath: string) => Promise<Uint8Array>
): Promise<Uint8Array> {
  if (source.content !== undefined) {
    log(`[source_resolve] using inline content for ${source.label}`);
    return new TextEncoder().encode(source.content);
  }
  if (source.fsPath) {
    log(`[source_resolve] reading fsPath ${source.fsPath}`);
    return await readFile(source.fsPath);
  }
  throw new Error(`Cannot read source: ${source.label}`);
}
