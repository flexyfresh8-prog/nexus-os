// NEXUS OS — tests for the Git filesystem adapter (pure logic paths),
// runtime container-tree builder and calculator/bus helpers.

import { describe, expect, test } from "bun:test";
import { vfsToContainerTree } from "../store/runtime";
import { evaluateExpression } from "../lib/calc";

describe("vfsToContainerTree", () => {
  test("builds nested FileSystemTree from flat file list", () => {
    const tree = vfsToContainerTree([
      { relPath: "index.html", content: "<html></html>" },
      { relPath: "src/index.js", content: "console.log(1)" },
      { relPath: "src/lib/util.js", content: "export {}" },
      { relPath: "package.json", content: "{}" },
    ]);
    expect((tree["index.html"] as { file: { contents: string } }).file.contents).toBe("<html></html>");
    const src = tree["src"] as { directory: Record<string, unknown> };
    expect((src.directory["index.js"] as { file: { contents: string } }).file.contents).toBe("console.log(1)");
    const lib = src.directory["lib"] as { directory: Record<string, unknown> };
    expect("util.js" in lib.directory).toBe(true);
    expect("package.json" in tree).toBe(true);
  });

  test("handles empty project (just package.json later)", () => {
    expect(Object.keys(vfsToContainerTree([])).length).toBe(0);
  });
});

describe("calculator guard rails", () => {
  test("rejects injection-style input", () => {
    expect(() => evaluateExpression("process.exit(1)")).toThrow();
    expect(() => evaluateExpression("constructor")).toThrow();
  });
});
