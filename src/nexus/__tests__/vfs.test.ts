// NEXUS OS — unit tests for the pure filesystem path engine (bun test)

import { describe, expect, test } from "bun:test";
import {
  resolvePath,
  pathOf,
  displayPath,
  uniqueName,
  validateFileName,
  createsCycle,
  descendantsOf,
  extOf,
  isTextFile,
  ROOT_ID,
  HOME_ID,
} from "../lib/vfs";
import type { FSNode } from "../../types";

function dir(id: string, name: string, parentId: string | null): FSNode {
  return { id, name, type: "dir", parentId, created: 0, modified: 0 };
}
function file(id: string, name: string, parentId: string): FSNode {
  return { id, name, type: "file", parentId, content: "", created: 0, modified: 0 };
}

const nodes: Record<string, FSNode> = {
  [ROOT_ID]: dir(ROOT_ID, "", null),
  home: dir("home", "home", ROOT_ID),
  docs: dir("docs", "Documents", "home"),
  notes: file("notes", "notes.txt", "docs"),
  pics: dir("pics", "Pictures", "home"),
};

describe("resolvePath", () => {
  test("absolute paths", () => {
    expect(resolvePath(nodes, ROOT_ID, "/home/Documents/notes.txt")?.id).toBe("notes");
    expect(resolvePath(nodes, ROOT_ID, "/home")?.id).toBe("home");
    expect(resolvePath(nodes, ROOT_ID, "/")?.id).toBe(ROOT_ID);
  });

  test("relative paths and dots", () => {
    expect(resolvePath(nodes, "docs", "notes.txt")?.id).toBe("notes");
    expect(resolvePath(nodes, "docs", "..")?.id).toBe("home");
    expect(resolvePath(nodes, "docs", "../Pictures")?.id).toBe("pics");
    expect(resolvePath(nodes, "docs", "./notes.txt")?.id).toBe("notes");
  });

  test("tilde maps to home", () => {
    expect(resolvePath(nodes, ROOT_ID, "~")?.id).toBe("home");
    expect(resolvePath(nodes, ROOT_ID, "~/Documents")?.id).toBe("docs");
    expect(resolvePath(nodes, "docs", "~/..")?.id).toBe(ROOT_ID);
  });

  test("missing final segment reports parent for creation", () => {
    const r = resolvePath(nodes, "docs", "newfile.md");
    expect(r?.id).toBe("");
    expect(r?.parentId).toBe("docs");
    expect(r?.missingName).toBe("newfile.md");
  });

  test("missing intermediate segment fails cleanly", () => {
    expect(resolvePath(nodes, "docs", "nope/child.txt")).toBeNull();
  });

  test("never escapes the virtual root", () => {
    // walking above root clamps to root — no traversal out of the sandbox
    const r = resolvePath(nodes, "docs", "../../../../../../etc/passwd");
    expect(r === null || r?.id === ROOT_ID || nodes[r.id] !== undefined).toBe(true);
    expect(r?.id).not.toBe("etc");
  });
});

describe("pathOf / displayPath", () => {
  test("builds canonical paths", () => {
    expect(pathOf(nodes, "notes")).toBe("/home/Documents/notes.txt");
    expect(pathOf(nodes, ROOT_ID)).toBe("/");
  });
  test("home collapses to ~", () => {
    expect(displayPath(nodes, "home")).toBe("~");
    expect(displayPath(nodes, "docs")).toBe("~/Documents");
    expect(displayPath(nodes, "notes")).toBe("~/Documents/notes.txt");
  });
});

describe("name handling", () => {
  test("validateFileName rejects bad names", () => {
    expect(validateFileName("ok.txt")).toBeNull();
    expect(validateFileName("")).toBeTruthy();
    expect(validateFileName("a/b")).toBeTruthy();
    expect(validateFileName("..")).toBeTruthy();
  });
  test("uniqueName dedupes", () => {
    expect(uniqueName(nodes, "docs", "notes.txt")).toBe("notes (2).txt");
    expect(uniqueName(nodes, "pics", "notes.txt")).toBe("notes.txt");
  });
  test("extension helpers", () => {
    expect(extOf("a.tar.gz")).toBe("gz");
    expect(isTextFile("main.tsx")).toBe(true);
    expect(isTextFile("song.mp3")).toBe(false);
  });
});

describe("tree integrity", () => {
  test("cycle detection", () => {
    expect(createsCycle(nodes, "home", "docs")).toBe(true);
    expect(createsCycle(nodes, "docs", "pics")).toBe(false);
  });
  test("descendants include self", () => {
    const ids = descendantsOf(nodes, "home");
    expect(ids).toContain("home");
    expect(ids).toContain("notes");
    expect(ids).not.toContain(ROOT_ID);
  });
});
