import { expect, test } from "bun:test";
process.env.MANGO_REGISTRY = require("node:path").join(require("node:os").tmpdir(), `mango-registry-${process.pid}`);
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchOf, findRoot, knownRoots, messageName, readAll, readOne, snapshot, snapshotAll, write } from "./store";

const fresh = () => join(mkdtempSync(join(tmpdir(), "mango-")), ".mango");

test("write is atomic and readable; bad json is skipped", () => {
  const root = fresh();
  write(root, "agents", "a", { name: "a" });
  write(root, "agents", "b", { name: "b" });
  writeFileSync(join(root, "agents", "zz.json"), "{not json");
  expect(readdirSync(join(root, "agents")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  expect(readOne<{ name: string }>(root, "agents", "a")).toEqual({ name: "a" });
  expect(readAll(root, "agents").map((r) => r.name)).toEqual(["a", "b"]);
  expect(snapshot(root).agents).toHaveLength(2);
  expect(() => write(root, "agents", "../../outside", {})).toThrow(/invalid record name/);
});

test("message names sort by time", () => {
  const a = messageName("2026-09-23T10:00:00.000Z");
  const b = messageName("2026-09-23T10:00:01.000Z");
  expect(a < b).toBe(true);
});

test("findRoot walks up to .mango or .git", () => {
  const base = mkdtempSync(join(tmpdir(), "mango-root-"));
  write(join(base, ".mango"), "agents", "x", {});
  expect(findRoot(join(base, "deep", "er"))).toBe(join(base, ".mango"));
});

test("a git worktree resolves to the main checkout's store; branch is read from HEAD", () => {
  const base = mkdtempSync(join(tmpdir(), "mango-wt-"));
  const main = join(base, "main");
  mkdirSync(join(main, ".git", "worktrees", "feat"), { recursive: true });
  writeFileSync(join(main, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(main, ".git", "worktrees", "feat", "HEAD"), "ref: refs/heads/feat-x\n");
  const wt = join(base, "feat");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "feat")}\n`);
  expect(findRoot(join(wt, "src"))).toBe(join(main, ".mango"));
  expect(branchOf(wt)).toBe("feat-x");
  expect(branchOf(main)).toBe("main");
});

test("snapshot fills defaults for records that predate a field", () => {
  const root = fresh();
  write(root, "agents", "old", { name: "old", tool: "other", status: "idle", task: null, updated: "2026-01-01T00:00:00.000Z", inbox_cursor: "" });
  expect(snapshot(root).agents[0]).toMatchObject({ cwd: "", branch: null, session: null });
});

test("snapshot marks agents whose harness process is gone", () => {
  const root = fresh();
  write(root, "agents", "dead", { name: "dead", tool: "claude", status: "idle", task: null, updated: "2026-01-01T00:00:00.000Z", inbox_cursor: "", pid: 2147483000 });
  write(root, "agents", "live", { name: "live", tool: "claude", status: "idle", task: null, updated: "2026-01-01T00:00:00.000Z", inbox_cursor: "", pid: process.pid });
  const by = Object.fromEntries(snapshot(root).agents.map((a) => [a.name, a.alive]));
  expect(by).toEqual({ dead: false, live: true });
});

test("writes register their root; snapshotAll merges stores in time order", () => {
  const a = fresh(), b = fresh();
  write(a, "agents", "claude-1", { name: "claude-1", tool: "claude", status: "idle", task: null, updated: "", inbox_cursor: "" });
  write(b, "messages", messageName("2026-09-23T10:00:00.000Z"), { t: "2026-09-23T10:00:00.000Z", from: "x", to: "*", text: "first" });
  write(a, "messages", messageName("2026-09-23T10:00:01.000Z"), { t: "2026-09-23T10:00:01.000Z", from: "y", to: "*", text: "second" });
  expect(knownRoots()).toEqual(expect.arrayContaining([a, b]));
  const s = snapshotAll([a, b]);
  expect(s.repos).toHaveLength(2);
  expect(s.agents.map((x) => [x.name, x.repo])).toEqual([["claude-1", "mango-" + a.split("mango-")[1].split("/")[0]]]);
  expect(new Set(s.messages.map((m) => m.repo)).size).toBe(2);
  expect(s.messages.map((m) => m.text)).toEqual(["first", "second"]);
});

test("transcriptTouchedAt reads the transcript mtime for a claude agent", async () => {
  const { transcriptTouchedAt } = await import("./activity");
  const base = mkdtempSync(join(tmpdir(), "mango-tr-"));
  const cwd = join(base, "repo");
  const projects = join(base, "projects");
  mkdirSync(join(projects, cwd.replace(/[\\/:]/g, "-")), { recursive: true });
  writeFileSync(join(projects, cwd.replace(/[\\/:]/g, "-"), "abcd1234.jsonl"), "{}\n");
  process.env.MANGO_CLAUDE_PROJECTS = projects;
  const agent = { name: "claude-abcd", tool: "claude", status: "idle", task: null, updated: "", inbox_cursor: "", cwd, branch: null, session: "abcd1234", pid: null, alive: null, repo: "repo", activeAt: null } as const;
  const t = transcriptTouchedAt(agent);
  expect(t && Date.now() - Date.parse(t) < 60_000).toBe(true);
  delete process.env.MANGO_CLAUDE_PROJECTS;
});
