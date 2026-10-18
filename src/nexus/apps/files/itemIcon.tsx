"use client";

// NEXUS OS — Files app: node type icons, kind labels, download helper

import {
  File,
  FileCode,
  FileImage,
  FileMusic,
  FileText,
  FileVideo,
  Folder,
} from "lucide-react";
import type { FSNode } from "../../types";
import {
  AUDIO_EXTS,
  CODE_EXTS,
  IMAGE_EXTS,
  TEXT_EXTS,
  VIDEO_EXTS,
  extOf,
} from "../../lib/vfs";
import { downloadBlob } from "../../lib/utils";

export function TypeIcon({ node, size = 40 }: { node: FSNode; size?: number }) {
  if (node.type === "dir") {
    return (
      <Folder
        size={size}
        strokeWidth={1.7}
        fill="currentColor"
        fillOpacity={0.16}
        className="shrink-0 text-amber-300"
      />
    );
  }
  const ext = extOf(node.name);
  if (ext === "pdf") {
    return <FileText size={size} strokeWidth={1.7} className="shrink-0 text-red-300" />;
  }
  if (ext === "txt" || ext === "md") {
    return <FileText size={size} strokeWidth={1.7} className="shrink-0 text-sky-300" />;
  }
  if (IMAGE_EXTS.has(ext)) {
    return <FileImage size={size} strokeWidth={1.7} className="shrink-0 text-violet-300" />;
  }
  if (AUDIO_EXTS.has(ext)) {
    return <FileMusic size={size} strokeWidth={1.7} className="shrink-0 text-pink-300" />;
  }
  if (VIDEO_EXTS.has(ext)) {
    return <FileVideo size={size} strokeWidth={1.7} className="shrink-0 text-rose-300" />;
  }
  if (CODE_EXTS.has(ext)) {
    return <FileCode size={size} strokeWidth={1.7} className="shrink-0 text-emerald-300" />;
  }
  if (TEXT_EXTS.has(ext)) {
    return <FileText size={size} strokeWidth={1.7} className="shrink-0 text-sky-300" />;
  }
  return <File size={size} strokeWidth={1.7} className="shrink-0 text-zinc-400" />;
}

const KIND_BY_EXT: Record<string, string> = {
  txt: "Plain text",
  md: "Markdown",
  json: "JSON",
  html: "HTML document",
  htm: "HTML document",
  css: "Stylesheet",
  scss: "Stylesheet",
  js: "JavaScript",
  jsx: "JSX component",
  ts: "TypeScript",
  tsx: "TSX component",
  py: "Python script",
  sh: "Shell script",
  csv: "CSV data",
  xml: "XML document",
  yml: "YAML data",
  yaml: "YAML data",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  webp: "WebP image",
  svg: "SVG image",
  bmp: "Bitmap image",
  ico: "Icon image",
  avif: "AVIF image",
  mp3: "MP3 audio",
  wav: "WAV audio",
  ogg: "OGG audio",
  m4a: "M4A audio",
  flac: "FLAC audio",
  aac: "AAC audio",
  mp4: "MP4 video",
  webm: "WebM video",
  mov: "QuickTime video",
  mkv: "Matroska video",
  avi: "AVI video",
  pdf: "PDF document",
};

export function kindOf(node: FSNode): string {
  if (node.type === "dir") return "Folder";
  const ext = extOf(node.name);
  if (KIND_BY_EXT[ext]) return KIND_BY_EXT[ext];
  if (IMAGE_EXTS.has(ext)) return "Image";
  if (AUDIO_EXTS.has(ext)) return "Audio";
  if (VIDEO_EXTS.has(ext)) return "Video";
  if (CODE_EXTS.has(ext)) return "Code";
  if (TEXT_EXTS.has(ext)) return "Text";
  return ext ? `${ext.toUpperCase()} file` : "File";
}

/** Export a virtual file back to the host machine via the browser. */
export function downloadNode(node: FSNode): void {
  if (node.type !== "file") return;
  const blob =
    typeof node.content === "string"
      ? new Blob([node.content], { type: node.mime ?? "text/plain" })
      : new Blob([node.binary ?? new ArrayBuffer(0)], {
          type: node.mime ?? "application/octet-stream",
        });
  downloadBlob(blob, node.name);
}
