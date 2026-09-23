import { expect, test } from "bun:test";
process.env.MANGO_REGISTRY = require("node:path").join(require("node:os").tmpdir(), `mango-registry-${process.pid}`);
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { done, forget, harnessPid, hookText, inbox, note, send, start, status } from "./mango";
import { readOne, type Agent, type Task } from "./store";

const fresh = () => join(mkdtempSync(join(tmpdir(), "mango-")), ".mango");

test("start → note → done flow", () => {
  const root = fresh();
  const t = start(root, "claude-ab12", "Fix login");
  note(root, "claude-ab12", "found the bug");
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toMatchObject({ tool: "claude", status: "working", task: t.id, cwd: process.cwd(), branch: null });
  done(root, "claude-ab12", "shipped");
  expect(readOne<Task>(root, "tasks", t.id)).toMatchObject({ status: "done", log: [{ text: "found the bug" }, { text: "shipped" }] });
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toMatchObject({ status: "idle", task: null });
  expect(() => note(root, "claude-ab12", "x")).toThrow(/no open task/);
});

test("status blocked logs the reason on the open task", () => {
  const root = fresh();
  const t = start(root, "codex-9f3e", "Migrate DB");
  status(root, "codex-9f3e", "blocked", "waiting on schema");
  expect(readOne<Task>(root, "tasks", t.id)!.log[0].text).toBe("blocked: waiting on schema");
});

test("inbox returns DMs and broadcasts, not own messages, and advances the cursor", () => {
  const root = fresh();
  send(root, "codex-9f3e", "claude-ab12", "schema merged");
  send(root, "codex-9f3e", "*", "CI green");
  send(root, "claude-ab12", "*", "ack");
  send(root, "codex-9f3e", "opencode-1", "not for claude");
  expect(inbox(root, "claude-ab12", true).map((m) => m.text)).toEqual(["schema merged", "CI green"]);
  expect(inbox(root, "claude-ab12").map((m) => m.text)).toEqual(["schema merged", "CI green"]);
  expect(inbox(root, "claude-ab12")).toEqual([]);
  send(root, "codex-9f3e", "*", "one more");
  expect(inbox(root, "claude-ab12").map((m) => m.text)).toEqual(["one more"]);
});

test("hook text: full shows identity + commands + task; prompt turn shows unread only", () => {
  const root = fresh();
  start(root, "claude-ab12", "Fix login");
  send(root, "codex-9f3e", "*", "CI green");
  const full = hookText(root, "claude-ab12", true);
  expect(full).toContain('You are "claude-ab12"');
  expect(full).toContain("--as claude-ab12 start");
  expect(full).toContain("Current task t-");
  expect(full).toContain("codex-9f3e → all: CI green");
  expect(hookText(root, "claude-ab12", false)).toBe("");
  expect(readOne<Agent>(root, "agents", "claude-new")).toBeNull();
  hookText(root, "claude-new", true);
  expect(readOne<Agent>(root, "agents", "claude-new")).toMatchObject({ status: "idle" });
});

test("several starts queue tasks; start t-id switches the current one", () => {
  const root = fresh();
  const a = start(root, "claude-ab12", "first");
  const b = start(root, "claude-ab12", "second");
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.task).toBe(b.id);
  expect(readOne<Task>(root, "tasks", a.id)!.status).toBe("open");
  expect(start(root, "claude-ab12", a.id).id).toBe(a.id);
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.task).toBe(a.id);
  expect(() => start(root, "codex-9f3e", a.id)).toThrow(/not an open task/);
});

test("harnessPid skips shells and returns a running process; forget removes the record", () => {
  const pid = harnessPid();
  expect(pid === null || pid > 1).toBe(true);
  const root = fresh();
  start(root, "claude-ab12", "x");
  forget(root, "claude-ab12");
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toBeNull();
  expect(() => forget(root, "claude-ab12")).toThrow(/no agent/);
});

test("task writes take a lock; a stale lock from a dead writer is taken over", () => {
  const root = fresh();
  const t = start(root, "claude-ab12", "locked");
  const lock = join(root, "tasks", `.${t.id}.lock`);
  mkdirSync(lock);
  const old = new Date(Date.now() - 10_000);
  utimesSync(lock, old, old);
  note(root, "claude-ab12", "got through");
  expect(readOne<Task>(root, "tasks", t.id)!.log.map((l) => l.text)).toEqual(["got through"]);
  expect(existsSync(lock)).toBe(false);
});
