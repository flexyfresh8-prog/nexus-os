"use client";

// NEXUS OS — Media Player. Imports real audio/video files into the virtual
// filesystem (they persist in IndexedDB) and plays them from object URLs.
// Supported formats = whatever the browser codec stack supports.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Music, Play, Pause, Volume2, Video } from "lucide-react";
import type { AppInstanceProps, FSNode } from "../../types";
import { useFS } from "../../store/fs";
import { HOME_ID, AUDIO_EXTS, VIDEO_EXTS, childrenOf, descendantsOf, extOf, displayPath, nodeSize } from "../../lib/vfs";
import { formatBytes, uid } from "../../lib/utils";

interface MediaItem {
  id: string;
  name: string;
  kind: "audio" | "video";
  url: string;
  size: number;
  path: string;
}

function scanMedia(nodes: Record<string, FSNode>): MediaItem[] {
  const out: MediaItem[] = [];
  for (const node of Object.values(nodes)) {
    if (node.type !== "file") continue;
    const ext = extOf(node.name);
    const isAudio = AUDIO_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isAudio && !isVideo) continue;
    const binary = node.binary;
    if (!binary) continue;
    out.push({
      id: node.id,
      name: node.name,
      kind: isAudio ? "audio" : "video",
      url: URL.createObjectURL(new Blob([binary], { type: node.mime ?? (isAudio ? "audio/mpeg" : "video/mp4") })),
      size: nodeSize(node),
      path: displayPath(nodes, node.id),
    });
  }
  return out;
}

export default function MediaPlayerApp(_props: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [current, setCurrent] = useState<MediaItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);

  // rescan when the FS changes; revoke stale object URLs
  useEffect(() => {
    const next = scanMedia(nodes);
    setItems((prev) => {
      for (const p of prev) {
        if (!next.find((n) => n.id === p.id)) URL.revokeObjectURL(p.url);
      }
      return next;
    });
  }, [nodes]);

  useEffect(() => {
    return () => {
      for (const it of items) URL.revokeObjectURL(it.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importFiles = useCallback(async (files: FileList) => {
    setImporting(true);
    try {
      const fs = useFS.getState();
      const home = fs.nodes[HOME_ID];
      const musicId = home ? childrenOf(fs.nodes, HOME_ID).find((c) => c.name === "Music")?.id : undefined;
      const music = musicId ?? fs.mkdirAtPath("Music", HOME_ID);
      if (typeof music !== "string" || !fs.nodes[music]) return;
      for (const file of Array.from(files).slice(0, 8)) {
        if (file.size > 60 * 1024 * 1024) continue; // IndexedDB sanity cap
        const buf = await file.arrayBuffer();
        fs.createNode({
          parentId: music,
          name: file.name,
          type: "file",
          binary: buf,
          mime: file.type || undefined,
          autoRename: true,
        });
      }
    } finally {
      setImporting(false);
    }
  }, []);

  const audioItems = useMemo(() => items.filter((i) => i.kind === "audio"), [items]);
  const videoItems = useMemo(() => items.filter((i) => i.kind === "video"), [items]);

  const play = (item: MediaItem) => {
    setCurrent(item);
    setPlaying(true);
    requestAnimationFrame(() => {
      mediaRef.current?.play().catch(() => setPlaying(false));
    });
  };

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* library */}
      <div className="flex w-[250px] min-w-[200px] flex-col border-r border-white/5 bg-black/15">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/5 p-2.5">
          <span className="flex-1 text-[12px] font-medium text-[var(--nx-text)]">Library</span>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-2.5 py-1.5 text-[11px] text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.25)] disabled:opacity-50"
          >
            <FolderOpen size={12} /> Import
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="px-2 py-4 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
              No media yet. Import audio or video files — they are stored in the virtual
              filesystem (~/Music) and persist across reloads.
            </p>
          ) : (
            <>
              {audioItems.length > 0 && <SectionLabel icon={<Music size={11} />} label={`Audio (${audioItems.length})`} />}
              {audioItems.map((it) => (
                <MediaRow key={it.id} item={it} active={current?.id === it.id} onPlay={() => play(it)} />
              ))}
              {videoItems.length > 0 && <SectionLabel icon={<Video size={11} />} label={`Video (${videoItems.length})`} />}
              {videoItems.map((it) => (
                <MediaRow key={it.id} item={it} active={current?.id === it.id} onPlay={() => play(it)} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* player */}
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-black/25 p-6">
        {current ? (
          <>
            {current.kind === "video" ? (
              <video
                ref={mediaRef}
                src={current.url}
                controls={false}
                className="max-h-[62%] max-w-full rounded-xl border border-white/10 shadow-2xl"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => {
                  const el = e.currentTarget;
                  setProgress(el.duration ? el.currentTime / el.duration : 0);
                }}
                onEnded={() => setPlaying(false)}
              />
            ) : (
              <div className="mb-6 flex flex-col items-center">
                <div className={`grid h-28 w-28 place-items-center rounded-full border border-[rgba(var(--nx-accent-rgb),0.3)] bg-[rgba(var(--nx-accent-rgb),0.08)] ${playing ? "nx-pulse" : ""}`}>
                  <Music size={40} className="text-[var(--nx-accent)]" />
                </div>
                <audio
                  ref={mediaRef as unknown as React.RefObject<HTMLAudioElement>}
                  src={current.url}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => {
                    const el = e.currentTarget;
                    setProgress(el.duration ? el.currentTime / el.duration : 0);
                  }}
                  onEnded={() => setPlaying(false)}
                />
              </div>
            )}
            <div className="mt-4 w-full max-w-md text-center">
              <div className="truncate text-[13px] font-medium text-[var(--nx-text)]">{current.name}</div>
              <div className="text-[10px] text-[var(--nx-text-dim)]">
                {current.path} · {formatBytes(current.size)}
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[var(--nx-accent)] transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="mt-4 flex items-center justify-center gap-4">
                <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="grid h-11 w-11 place-items-center rounded-full bg-[var(--nx-accent)] text-black transition hover:brightness-110">
                  {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
                </button>
                <div className="flex items-center gap-2">
                  <Volume2 size={14} className="text-[var(--nx-text-dim)]" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      if (mediaRef.current) mediaRef.current.volume = v;
                    }}
                    aria-label="Volume"
                    className="w-24 accent-[var(--nx-accent)]"
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="max-w-[300px] text-center">
            <div className="mb-3 text-3xl">🎧</div>
            <p className="text-[13px] text-[var(--nx-text)]">Nothing playing</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
              Pick something from the library. Files play locally from the virtual filesystem —
              playback support depends on your browser&apos;s codecs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--nx-text-dim)]">
      {icon} {label}
    </div>
  );
}

function MediaRow({ item, active, onPlay }: { item: MediaItem; active: boolean; onPlay: () => void }) {
  return (
    <button
      onClick={onPlay}
      className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
        active ? "bg-[rgba(var(--nx-accent-rgb),0.12)]" : "hover:bg-white/5"
      }`}
    >
      <Play size={11} className={`shrink-0 ${active ? "text-[var(--nx-accent)]" : "text-[var(--nx-text-dim)]"}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-[var(--nx-text)]">{item.name}</div>
        <div className="text-[10px] text-[var(--nx-text-dim)]">{formatBytes(item.size)}</div>
      </div>
    </button>
  );
}

// keep uid referenced for future playlist features
void uid;
