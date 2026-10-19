"use client";

// NEXUS OS — Document Viewer. Previews real files from the virtual
// filesystem: Markdown (rendered), PDF (embedded), code/text (highlighted
// plain), CSV (table). Export downloads the original bytes.

import { useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { AppInstanceProps, FSNode } from "../../types";
import { useFS } from "../../store/fs";
import { extOf, isTextFile, displayPath, nodeSize, pathOf, resolvePath, HOME_ID } from "../../lib/vfs";
import { formatBytes } from "../../lib/utils";
import { useNexusEvent } from "../../lib/bus";

interface DocItem {
  id: string;
  name: string;
  path: string;
  size: number;
  kind: "markdown" | "pdf" | "text" | "csv" | "json" | "image";
}

function listDocs(nodes: Record<string, FSNode>): DocItem[] {
  const out: DocItem[] = [];
  for (const node of Object.values(nodes)) {
    if (node.type !== "file") continue;
    const ext = extOf(node.name);
    let kind: DocItem["kind"] | null = null;
    if (ext === "md" || ext === "markdown") kind = "markdown";
    else if (ext === "pdf") kind = node.binary ? "pdf" : null;
    else if (ext === "csv") kind = "csv";
    else if (ext === "json") kind = "json";
    else if (isTextFile(node.name, node.mime)) kind = "text";
    else if (node.binary && node.mime?.startsWith("image/")) kind = "image";
    if (!kind) continue;
    out.push({
      id: node.id,
      name: node.name,
      path: displayPath(nodes, node.id),
      size: nodeSize(node),
      kind,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export default function DocumentViewerApp({ launchProps }: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const docs = useMemo(() => listDocs(nodes), [nodes]);
  const [selectedId, setSelectedId] = useState<string | null>(
    typeof launchProps?.openFileId === "string" ? (launchProps.openFileId as string) : null
  );

  // pre-select the first doc
  useEffect(() => {
    if (!selectedId && docs.length > 0) setSelectedId(docs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.length]);

  useNexusEvent("os:open-path", ({ fileId }) => {
    if (nodes[fileId]) setSelectedId(fileId);
  });

  const current = selectedId ? nodes[selectedId] : undefined;
  const currentDoc = current ? docs.find((d) => d.id === current.id) : undefined;

  const download = (node: FSNode) => {
    const blob =
      node.binary
        ? new Blob([node.binary], { type: node.mime ?? "application/octet-stream" })
        : new Blob([node.content ?? ""], { type: node.mime ?? "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = node.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="flex h-full">
      {/* sidebar */}
      <div className="flex w-[230px] min-w-[180px] flex-col border-r border-white/5 bg-black/15">
        <div className="shrink-0 border-b border-white/5 px-3 py-2 text-[12px] font-medium text-[var(--nx-text)]">
          Documents <span className="text-[var(--nx-text-dim)]">({docs.length})</span>
        </div>
        <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {docs.length === 0 ? (
            <p className="px-2 py-4 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
              No documents found. Create .md files in Files or Notes, or import files.
            </p>
          ) : (
            docs.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  selectedId === d.id ? "bg-[rgba(var(--nx-accent-rgb),0.12)]" : "hover:bg-white/5"
                }`}
              >
                <FileText size={13} className={`shrink-0 ${selectedId === d.id ? "text-[var(--nx-accent)]" : "text-[var(--nx-text-dim)]"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-[var(--nx-text)]">{d.name}</div>
                  <div className="truncate text-[10px] text-[var(--nx-text-dim)]">{d.path}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* viewer */}
      <div className="flex min-w-0 flex-1 flex-col">
        {current && currentDoc ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--nx-text)]">
                {current.name}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--nx-text-dim)]">
                {currentDoc.kind} · {formatBytes(nodeSize(current))}
              </span>
              <button
                onClick={() => download(current)}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
              >
                <Download size={11} /> Export
              </button>
            </div>
            <div className="nx-scroll min-h-0 flex-1 overflow-auto">
              <DocBody node={current} kind={currentDoc.kind} />
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center">
            <div className="max-w-[300px] text-center">
              <div className="mb-3 text-3xl">📄</div>
              <p className="text-[13px] text-[var(--nx-text)]">Nothing open</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
                Select a document on the left. Markdown renders, PDFs embed, CSVs become tables,
                and text files show with line numbers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DocBody({ node, kind }: { node: FSNode; kind: DocItem["kind"] }) {
  if (kind === "pdf" && node.binary) {
    const url = URL.createObjectURL(new Blob([node.binary], { type: "application/pdf" }));
    return (
      <object data={url} type="application/pdf" className="h-full min-h-[400px] w-full">
        <p className="p-4 text-[12px] text-[var(--nx-text-dim)]">
          PDF embedding is blocked by this browser. Use Export to download it.
        </p>
      </object>
    );
  }

  if (kind === "markdown") {
    return (
      <div className="mx-auto max-w-3xl p-6 text-[13px] leading-relaxed text-[var(--nx-text)] [&_a]:text-[var(--nx-accent)] [&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-white/5 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-white/10 [&_li]:mb-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:text-[12px] [&_strong]:text-white [&_table]:my-3 [&_table]:w-full [&_table]:text-[12px] [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown>{node.content ?? ""}</ReactMarkdown>
      </div>
    );
  }

  if (kind === "csv") {
    const rows = (node.content ?? "").split(/\r?\n/).filter((r) => r.trim());
    const parsed = rows.slice(0, 300).map((r) => r.split(","));
    return (
      <table className="mx-auto my-4 text-[12px] text-[var(--nx-text)]">
        <tbody>
          {parsed.map((cells, i) => (
            <tr key={i} className={i === 0 ? "bg-white/5 font-medium" : ""}>
              {cells.map((c, j) => (
                <td key={j} className="border border-white/10 px-2.5 py-1">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (kind === "json") {
    let pretty = node.content ?? "";
    try {
      pretty = JSON.stringify(JSON.parse(pretty), null, 2);
    } catch { /* show raw */ }
    return <CodeText text={pretty} />;
  }

  return <CodeText text={node.content ?? ""} />;
}

function CodeText({ text }: { text: string }) {
  const lines = text.split("\n").slice(0, 5000);
  return (
    <div className="mx-auto max-w-4xl p-4 font-mono text-[12px] leading-[1.55]">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span className="w-10 shrink-0 select-none pr-3 text-right text-[var(--nx-text-dim)] opacity-60">{i + 1}</span>
          <span className="whitespace-pre-wrap break-words text-[var(--nx-text)]">{l || " "}</span>
        </div>
      ))}
    </div>
  );
}
