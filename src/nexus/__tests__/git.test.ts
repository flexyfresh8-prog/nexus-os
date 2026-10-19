// NEXUS OS — git adapter integration test (bun, in-memory FS store)

import { describe, expect, test } from "bun:test";
import { useFS } from "../store/fs";
import { HOME_ID } from "../lib/vfs";
import * as gitops from "../lib/gitops";

async function makeProject(name: string): Promise<string> {
  // ensure the in-memory FS is booted (IndexedDB unavailable in bun → RAM)
  if (!useFS.getState().ready) await useFS.getState().init();
  const res = useFS.getState().createNode({
    parentId: HOME_ID,
    name,
    type: "dir",
    autoRename: true,
  });
  if (!("id" in res)) throw new Error(res);
  const projectId = res.id;
  const r = useFS.getState().createFileAtPath("main.js", projectId, "console.log('hi');\n");
  if (typeof r !== "string" || !useFS.getState().nodes[r]) throw new Error("could not create main.js");
  return projectId;
}

describe("isomorphic-git over the NEXUS VFS", () => {
  test("init → add → commit → log → status → branch", async () => {
    const projectId = await makeProject("git-test-" + Date.now());
    const projectPath = "/home/" + useFS.getState().nodes[projectId].name;

    const initOut = await gitops.gitInit(projectPath);
    expect(initOut).toContain("Initialized");

    // fresh repo with no commits IS a repo
    expect(await gitops.gitIsRepo(projectPath)).toBe(true);

    const status1 = await gitops.gitStatus(projectPath);
    expect(status1.map((r) => r.path)).toContain("main.js");

    await gitops.gitStageAll(projectPath);

    const { short } = await gitops.gitCommit(projectPath, "first commit");
    expect(short).toHaveLength(7);

    const log = await gitops.gitLog(projectPath);
    expect(log.length).toBe(1);
    expect(log[0].message).toBe("first commit");

    const status2 = await gitops.gitStatus(projectPath);
    expect(status2.length).toBe(0); // clean after commit

    await gitops.gitCreateBranch(projectPath, "dev");
    const branches = await gitops.gitBranches(projectPath);
    expect(branches.all).toContain("dev");

    await gitops.gitCheckout(projectPath, "dev");
    const branches2 = await gitops.gitBranches(projectPath);
    expect(branches2.current).toBe("dev");
  });
});
