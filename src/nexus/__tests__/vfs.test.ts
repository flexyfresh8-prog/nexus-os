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
import type { FSNode } from "../types";

function dir(id: string, name: string, parentId: string | null): FSNode {
  return { id, name, type: "dir", parentId, created: 0, modified: 0 };
}

function file(id: string, name: string, parentId: string, content = ""): FSNode {
  return { id, name, type: "file", parentId, content, created: 0, modified: 0 };
}

function sampleTree(): Record<string, FSNode> {
  const nodes: Record<string, FSNode> = {};
  const add = (n: FSNode) => {
    nodes[n.id] = n;
  };
  add(dir(ROOT_ID, "", null));
  add(dir(HOME_ID, "home", ROOT_ID));
  add(dir("docs", "Documents", HOME_ID));
  add(dir("proj", "Projects", HOME_ID));
  add(dir("site", "hello-site", "proj"));
  add(file("idx", "index.html", "site", "<html></html>"));
  add(file("css", "styles.css", "site", "body{}"));
  add(file("readme", "readme.md", "docs", "# hi"));
  return nodes;
}

describe("resolvePath", () => {
  test("absolute, relative, tilde and dot-dot resolution", () => {
    const nodes = sampleTree();
    expect(resolvePath(nodes, HOME_ID, "/home/Documents")?.id).toBe("docs");
    expect(resolvePath(nodes, "docs", "../Projects/hello-site")?.id).toBe("site");
    expect(resolvePath(nodes, "site", "~/Documents")?.id).toBe("docs");
    expect(resolvePath(nodes, "docs", ".")?.id).toBe("docs");
    expect(resolvePath(nodes, "site", "..")?.id).toBe("proj");
    // missing last segment reports parent for creation
    const miss = resolvePath(nodes, "docs", "new.txt");
    expect(miss?.parentId).toBe("docs");
    expect(miss?.missingName).toBe("new.txt");
    // traversal beyond root is contained
    expect(resolvePath(nodes, "docs", "../../etc/passwd")?.id).not.toBe("");
  });

  test("rejects traversal through non-directories", () => {
    const nodes = sampleTree();
    expect(resolvePath(nodes, "docs", "readme.md/x")).toBeNull();
  });
});

describe("pathOf / displayPath", () => {
  test("builds correct paths and tilde form", () => {
    const nodes = sampleTree();
    expect(pathOf(nodes, "idx")).toBe("/home/Projects/hello-site/index.html");
    expect(displayPath(nodes, "docs")).toBe("~/Documents");
    expect(displayPath(nodes, "readme")).toBe("~/Documents/readme.md");
  });
});

describe("uniqueName", () => {
  test("deconflicts without clobbering extensions", () => {
    const nodes = sampleTree();
    expect(uniqueName(nodes, "site", "index.html")).toBe("index (2).html");
    expect(uniqueName(nodes, "site", "app.js")).toBe("app.js");
  });
});

describe("validateFileName", () => {
  test("blocks dangerous names", () => {
    expect(validateFileName("")).toBeTruthy();
    expect(validateFileName("a/b")).toBeTruthy();
    expect(validateFileName("..")).toBeTruthy();
    expect(validateFileName("ok-file_1.txt")).toBeNull();
  });
});

describe("createsCycle / descendantsOf", () => {
  test("cycle detection and subtree collection", () => {
    const nodes = sampleTree();
    expect(createsCycle(nodes, "proj", "site")).toBe(true);
    expect(createsCycle(nodes, "site", "proj")).toBe(false);
    const desc = descendantsOf(nodes, "site").sort();
    expect(desc).toEqual(["css", "idx", "site"]);
  });
});

describe("file classification", () => {
  test("extensions and text detection", () => {
    expect(extOf("archive.tar.gz")).toBe("gz");
    expect(extOf("noext")).toBe("");
    expect(isTextFile("script.ts")).toBe(true);
    expect(isTextFile("photo.png")).toBe(false);
    expect(isTextFile("image.svg")).toBe(true);
  });
});
