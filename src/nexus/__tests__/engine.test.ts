// NEXUS OS — tests for terminal tokenizer, calculator parser and git diff

import { describe, expect, test } from "bun:test";
import { tokenize } from "../apps/terminal/engine";
import { evaluateExpression, formatCalcResult } from "../lib/calc";
import { lineDiff } from "../lib/gitops";

describe("shell tokenizer (no eval)", () => {
  test("splits on whitespace and respects quotes", () => {
    expect(tokenize("ls -la")).toEqual(["ls", "-la"]);
    expect(tokenize('write notes.txt "hello world"')).toEqual(["write", "notes.txt", "hello world"]);
    expect(tokenize("echo 'single \"quoted\"'")).toEqual(["echo", 'single "quoted"']);
    expect(tokenize("path/to/file\\ name")).toEqual(["path/to/file name"]);
    expect(tokenize('echo ""')).toEqual(["echo", ""]);
  });

  test("handles escaped characters inside double quotes", () => {
    expect(tokenize('echo "a\\"b"')).toEqual(["echo", 'a"b']);
  });
});

describe("calculator parser", () => {
  test("arithmetic with precedence", () => {
    expect(evaluateExpression("2+3*4")).toBe(14);
    expect(evaluateExpression("(2+3)*4")).toBe(20);
    expect(evaluateExpression("2^3^2")).toBe(512); // right-associative
    expect(evaluateExpression("-5 + 3")).toBe(-2);
    expect(evaluateExpression("10 % 3")).toBe(1);
  });

  test("functions and constants", () => {
    expect(evaluateExpression("sqrt(16)")).toBe(4);
    expect(evaluateExpression("abs(-8)")).toBe(8);
    expect(evaluateExpression("round(2.6)")).toBe(3);
    expect(evaluateExpression("2pi")).toBeCloseTo(Math.PI * 2, 10);
    expect(evaluateExpression("ln(e)")).toBeCloseTo(1, 10);
    expect(evaluateExpression("cos(60)")).toBeCloseTo(0.5, 10); // degrees
  });

  test("division by zero throws a real error", () => {
    expect(() => evaluateExpression("1/0")).toThrow(/Division by zero/);
    expect(() => evaluateExpression("unknownfn(2)")).toThrow();
    expect(() => evaluateExpression("(2+3")).toThrow(/parenthesis/i);
  });

  test("formatting trims noise", () => {
    expect(formatCalcResult(10)).toBe("10");
    expect(formatCalcResult(0.1 + 0.2)).toBe("0.3");
  });
});

describe("line diff", () => {
  test("detects additions, deletions and context", () => {
    const d = lineDiff(["a", "b", "c"], ["a", "B", "c", "d"]);
    const kinds = d.map((l) => l.kind);
    expect(kinds).toContain("del");
    expect(kinds).toContain("add");
    expect(d.filter((l) => l.kind === "ctx").map((l) => l.text)).toEqual(["a", "c"]);
  });

  test("identical inputs produce only context", () => {
    const d = lineDiff(["x", "y"], ["x", "y"]);
    expect(d.every((l) => l.kind === "ctx" || l.kind === "gap")).toBe(true);
  });
});


// regression: chained commands with tilde paths (cd bug fix)
import { runCommand } from "../apps/terminal/engine";
import { useFS } from "../store/fs";
import { HOME_ID, resolvePath } from "../lib/vfs";

describe("shell chaining + tilde paths", () => {
  test("mkdir/write/cd chain resolves ~ against home", async () => {
    if (!useFS.getState().ready) await useFS.getState().init();
    let cwd = HOME_ID;
    const ctx = {
      cwdId: HOME_ID,
      env: "shell" as const,
      setCwd: (id: string) => { cwd = id; },
      setEnv: () => {},
      clearScreen: () => {},
      openApp: () => {},
      history: [] as string[],
    };
    const res = await runCommand(
      'mkdir -p ~/Projects/chainapp && write ~/Projects/chainapp/index.html "<h1>ok</h1>" && cd ~/Projects/chainapp && pwd',
      ctx as never
    );
    expect(res.error).toBeFalsy();
    expect(res.output).toContain("/home/Projects/chainapp");
    expect(cwd).not.toBe(HOME_ID);
    expect(!!resolvePath(useFS.getState().nodes, HOME_ID, "~/Projects/chainapp/index.html")?.id).toBe(true);
  });

  test("&& short-circuits on failure", async () => {
    const ctx = {
      cwdId: HOME_ID,
      env: "shell" as const,
      setCwd: () => {},
      setEnv: () => {},
      clearScreen: () => {},
      openApp: () => {},
      history: [] as string[],
    };
    const res = await runCommand("cd /definitely/missing && echo should-not-run", ctx as never);
    expect(res.error).toBe(true);
    expect(res.output.join("\n")).not.toContain("should-not-run");
  });
});
