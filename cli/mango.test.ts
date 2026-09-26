import { expect, test } from "bun:test";
process.env.MANGO_REGISTRY = require("node:path").join(require("node:os").tmpdir(), `mango-registry-${process.pid}`);
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { block, done, drop, forget, harnessPid, hookText, inbox, note, register, review, send, start, status, setMeta } from "./mango";
import { branchOf, readOne, snapshot, write, type Agent, type Task } from "./store";

const fresh = () => join(mkdtempSync(join(tmpdir(), "mango-")), ".mango");

test("start → note → done flow", () => {
  const root = fresh();
  const t = start(root, "claude-ab12", "Fix login");
  note(root, "claude-ab12", "found the bug");
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toMatchObject({ tool: "claude", status: "working", task: t.id, cwd: process.cwd(), branch: branchOf(process.cwd()) });
  done(root, "claude-ab12", "shipped");
  expect(readOne<Task>(root, "tasks", t.id)).toMatchObject({ status: "done", log: [{ text: "found the bug" }, { text: "shipped" }] });
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toMatchObject({ status: "idle", task: null });
  expect(() => note(root, "claude-ab12", "x")).toThrow(/no (open|current) task/);
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
  expect(readOne<Task>(root, "tasks", a.id)!.status).toBe("queued");
  expect(start(root, "claude-ab12", a.id).id).toBe(a.id);
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.task).toBe(a.id);
  expect(() => start(root, "codex-9f3e", a.id)).toThrow(/not a live task/);
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

test("agent names cannot escape the store", () => {
  const root = fresh();
  expect(() => start(root, "../outside", "x")).toThrow(/invalid agent name/);
  expect(() => forget(root, "../../package")).toThrow(/invalid agent name/);
});

test("poisoned record fields cannot redirect a write", () => {
  const root = fresh();
  const victim = join(dirname(root), "victim.json");
  start(root, "safe", "first");
  writeFileSync(victim, "untouched");
  writeFileSync(join(root, "agents", "safe.json"), JSON.stringify({ name: "../../victim", task: null }));
  expect(() => register(root, "safe")).toThrow(/name mismatch/);
  expect(readFileSync(victim, "utf8")).toBe("untouched");
  const task = start(root, "claude-ab12", "second");
  writeFileSync(join(root, "tasks", `${task.id}.json`), JSON.stringify({ ...task, id: "../../victim" }));
  expect(() => note(root, "claude-ab12", "late")).toThrow(/no open task/);
  expect(readFileSync(victim, "utf8")).toBe("untouched");
});

test("a finished task cannot be reopened by a stale agent pointer", () => {
  const root = fresh();
  const task = start(root, "claude-ab12", "Finish safely");
  write(root, "tasks", task.id, { ...task, status: "done", ended: new Date().toISOString() });
  expect(snapshot(root).agents[0]).toMatchObject({ status: "idle", task: null });
  expect(() => note(root, "claude-ab12", "late note")).toThrow(/no open task/);
  register(root, "claude-ab12");
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toMatchObject({ status: "idle", task: null });
  expect(readOne<Task>(root, "tasks", task.id)).toMatchObject({ status: "done", log: [] });
});

test("task writes never steal an old lock", () => {
  const root = fresh();
  const t = start(root, "claude-ab12", "locked");
  const lock = join(root, "tasks", `.${t.id}.lock`);
  mkdirSync(lock);
  const old = new Date(Date.now() - 10_000);
  utimesSync(lock, old, old);
  expect(() => note(root, "claude-ab12", "late writer")).toThrow(/locked by another writer/);
  expect(readOne<Task>(root, "tasks", t.id)!.log).toEqual([]);
  expect(existsSync(lock)).toBe(true);
});

test("hashtags in a title become tags", () => {
  const root = fresh();
  const t = start(root, "claude-ab12", "Fix login redirect #auth #Urgent");
  expect(t).toMatchObject({ title: "Fix login redirect", tags: ["auth", "urgent"] });
  expect(() => start(root, "claude-ab12", "#only-tags")).toThrow(/needs a title/);
});

test("a CLI write keeps the directory the hook recorded", () => {
  const root = fresh();
  setMeta({ cwd: "/repo", session: "s1", pid: null, hook: true });
  start(root, "claude-ab12", "x");
  setMeta({ cwd: "/repo/sub/dir", session: null, pid: null, hook: false });
  note(root, "claude-ab12", "from a subfolder");
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.cwd).toBe("/repo");
  setMeta({ cwd: process.cwd(), session: null, pid: null, hook: false });
});

test("lifecycle: running → review → done; block/resume; drop; start parks the running one", () => {
  const root = fresh();
  const a = start(root, "claude-ab12", "first");
  const b = start(root, "claude-ab12", "second");
  expect(readOne<Task>(root, "tasks", a.id)!.status).toBe("queued");
  expect(readOne<Task>(root, "tasks", b.id)!.status).toBe("running");
  review(root, "claude-ab12", "PR open");
  expect(readOne<Task>(root, "tasks", b.id)).toMatchObject({ status: "review" });
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.task).toBe(b.id);
  block(root, "claude-ab12", "waiting on CI creds");
  expect(readOne<Task>(root, "tasks", b.id)!.log.at(-1)!.text).toBe("blocked: waiting on CI creds");
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.status).toBe("blocked");
  status(root, "claude-ab12", "working");
  expect(readOne<Task>(root, "tasks", b.id)!.status).toBe("running");
  done(root, "claude-ab12", "merged");
  expect(readOne<Task>(root, "tasks", b.id)).toMatchObject({ status: "done" });
  expect(readOne<Agent>(root, "agents", "claude-ab12")).toMatchObject({ status: "idle", task: null });
  start(root, "claude-ab12", a.id);
  expect(readOne<Task>(root, "tasks", a.id)!.status).toBe("running");
  drop(root, "claude-ab12", a.id, "superseded");
  expect(readOne<Task>(root, "tasks", a.id)).toMatchObject({ status: "dropped" });
  expect(readOne<Agent>(root, "agents", "claude-ab12")!.task).toBeNull();
});
