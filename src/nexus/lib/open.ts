// NEXUS OS — smart file opening: route a VFS file to the app that handles it
// best. Shared by Spotlight, Files, Terminal and the AI agent so the whole
// system behaves consistently.

import { useFS } from "../store/fs";
import { useOS } from "../store/os";
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS, extOf, isTextFile } from "./vfs";

/** Return the app id that should open this file, or "files" as fallback. */
export function bestAppForFile(name: string, mime?: string): string {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return "images";
  if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return "media";
  if (ext === "pdf") return "docsview";
  if (ext === "csv" || ext === "md" || ext === "markdown") return "docsview";
  if (isTextFile(name, mime)) return "studio";
  if (mime?.startsWith("image/")) return "images";
  if (mime?.startsWith("audio/") || mime?.startsWith("video/")) return "media";
  if (mime === "application/pdf") return "docsview";
  return "files";
}

/** Open a file (or folder) with the best-suited app. */
export function openFileWithBestApp(fileId: string): void {
  const node = useFS.getState().nodes[fileId];
  if (!node) return;
  const os = useOS.getState();
  if (node.type === "dir") {
    os.launch("files", { openId: fileId });
    return;
  }
  const app = bestAppForFile(node.name, node.mime);
  if (app === "files") {
    os.launch("files", { openId: node.parentId ?? fileId });
  } else {
    os.launch(app, { openFileId: fileId });
  }
}
