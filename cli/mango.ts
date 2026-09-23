#!/usr/bin/env bun
import { existsSync, mkdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { ADAPTERS, adapterFor, toolOf } from "./adapters";
import { agentNameFor, branchOf, findRoot, isValidRecordName, messageName, now, readAll, readOne, repoName, shortId, write, type Agent, type Message, type Status, type Task } from "./store";

/** How agents invoke mango. `bunx mango` once published; the local file until then. */
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const CMD = process.env.MANGO_CMD ?? `bun ${shellQuote(import.meta.path)}`;

/** Where the calling agent runs; hook mode overrides this from the harness's stdin. */
export let meta: { cwd: string; session: string | null; pid: number | null; hook: boolean } = { cwd: process.cwd(), session: null, pid: null, hook: false };
export const setMeta = (m: typeof meta) => { meta = m; };

function assertAgentName(name: string): void {
  if (!isValidRecordName(name)) throw new Error(`invalid agent name: ${name}`);
}

const agent = (root: string, name: string): Agent => {
  assertAgentName(name);
  const saved = readOne<Agent>(root, "agents", name);
  if (!saved) return { name, tool: toolOf(name), status: "idle", task: null, updated: now(), inbox_cursor: "", cwd: meta.cwd, branch: null, session: null, pid: null };
  if (saved.name !== name) throw new Error(`agent record name mismatch: ${name}`);
  if (!saved.task) return saved;
  const task = readOne<Task>(root, "tasks", saved.task);
  return task?.id === saved.task && task.agent === name && task.status === "open" ? saved : { ...saved, status: "idle", task: null };
};
const save = (root: string, a: Agent) =>
  write(root, "agents", a.name, {
    // The hook knows the session's real directory; a CLI call may run from any subfolder, so it keeps what's recorded.
    ...a, cwd: meta.hook || !a.cwd ? meta.cwd : a.cwd, branch: branchOf(meta.hook || !a.cwd ? meta.cwd : a.cwd), session: meta.session ?? a.session, pid: meta.pid ?? a.pid, updated: now(),
  });

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "bun", "node"]);
/** The process that spawned this hook: the first ancestor named like the harness, else the first non-shell one. */
export function harnessPid(names: string[] = []): number | null {
  let pid = process.ppid;
  let firstNonShell: number | null = null;
  for (let i = 0; i < 8 && pid > 1; i++) {
    const out = Bun.spawnSync(["ps", "-o", "ppid=,comm=", "-p", String(pid)]).stdout.toString().trim();
    if (!out) break;
    const [ppid, ...rest] = out.split(/\s+/);
    const comm = rest.join(" ").split("/").at(-1) ?? "";
    if (names.includes(comm)) return pid;
    if (!SHELLS.has(comm)) firstNonShell ??= pid;
    pid = Number(ppid);
  }
  return firstNonShell;
}

export function forget(root: string, name: string) {
  assertAgentName(name);
  withAgentLock(root, name, () => {
    const p = join(root, "agents", `${name}.json`);
    if (!existsSync(p)) throw new Error(`no agent named ${name}`);
    unlinkSync(p);
  });
}

/** Serialise record mutations across processes. */
function withLock<T>(root: string, kind: "agents" | "tasks", id: string, fn: () => T): T {
  if (!isValidRecordName(id)) throw new Error(`invalid record name: ${id}`);
  const dir = join(root, kind);
  const lock = join(dir, `.${id}.lock`);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // ponytail: fail on a stale lock rather than steal a live writer's lock; add owner-verified leases if crash recovery is needed.
      if (i >= 50) throw new Error(`${kind}/${id} is locked by another writer (remove ${lock} only if that writer is gone)`);
      Bun.sleepSync(10);
    }
  }
  try { return fn(); } finally { try { rmdirSync(lock); } catch { /* already gone */ } }
}
export const withTaskLock = <T>(root: string, id: string, fn: () => T) => withLock(root, "tasks", id, fn);
const withAgentLock = <T>(root: string, name: string, fn: () => T) => withLock(root, "agents", name, fn);

function openTask(root: string, a: Agent): Task {
  const t = a.task && readOne<Task>(root, "tasks", a.task);
  if (!t || t.id !== a.task || t.agent !== a.name || t.status !== "open") throw new Error(`${a.name} has no open task; run start first`);
  return t;
}

export function register(root: string, name: string) {
  assertAgentName(name);
  withAgentLock(root, name, () => save(root, agent(root, name)));
}

/** `#tags` anywhere in a title become the task's tags; the title keeps the rest. */
export function parseTitle(raw: string): { title: string; tags: string[] } {
  const tags = [...new Set([...raw.matchAll(/(?:^|\s)#([\w-]+)/g)].map((m) => m[1].toLowerCase()))];
  return { title: raw.replace(/(?:^|\s)#[\w-]+/g, "").replace(/\s+/g, " ").trim(), tags };
}

/** `start "title #tag"` opens a new task and makes it current; `start t-id` switches to one of the agent's open tasks.
 *  Other open tasks stay queued on the card. */
export function start(root: string, name: string, titleOrId: string): Task {
  assertAgentName(name);
  return withAgentLock(root, name, () => {
    const a = agent(root, name);
    const existing = /^t-[0-9a-f]{6,12}$/.test(titleOrId) ? readOne<Task>(root, "tasks", titleOrId) : null;
    if (existing) {
      if (existing.id !== titleOrId || existing.agent !== name || existing.status !== "open") throw new Error(`${titleOrId} is not an open task of ${name}`);
      save(root, { ...a, status: "working", task: existing.id });
      return existing;
    }
    const { title, tags } = parseTitle(titleOrId);
    if (!title) throw new Error("a task needs a title");
    const t: Task = { id: `t-${shortId()}`, agent: name, title, tags, status: "open", log: [], started: now(), ended: null };
    write(root, "tasks", t.id, t);
    save(root, { ...a, status: "working", task: t.id });
    return t;
  });
}

export function note(root: string, name: string, text: string) {
  assertAgentName(name);
  withAgentLock(root, name, () => {
    const a = agent(root, name);
    if (!a.task) throw new Error(`${name} has no open task; run start first`);
    withTaskLock(root, a.task, () => {
      const t = openTask(root, a);
      t.log.push({ t: now(), text });
      write(root, "tasks", t.id, t);
    });
    save(root, a);
  });
}

export function done(root: string, name: string, text?: string) {
  assertAgentName(name);
  withAgentLock(root, name, () => {
    const a = agent(root, name);
    if (!a.task) throw new Error(`${name} has no open task; run start first`);
    withTaskLock(root, a.task, () => {
      const t = openTask(root, a);
      if (text) t.log.push({ t: now(), text });
      write(root, "tasks", t.id, { ...t, status: "done", ended: now() });
    });
    save(root, { ...a, status: "idle", task: null });
  });
}

export function status(root: string, name: string, s: Status, why?: string) {
  assertAgentName(name);
  withAgentLock(root, name, () => {
    const a = agent(root, name);
    if (why && a.task) {
      withTaskLock(root, a.task, () => {
        const t = openTask(root, a);
        t.log.push({ t: now(), text: `${s}: ${why}` });
        write(root, "tasks", t.id, t);
      });
    }
    save(root, { ...a, status: s });
  });
}

export function send(root: string, from: string, to: string, text: string) {
  const m: Message = { t: now(), from, to, text };
  write(root, "messages", messageName(m.t), m);
}

/** Unread messages for `name`; advances the cursor unless peeking. */
export function inbox(root: string, name: string, peek = false): Message[] {
  assertAgentName(name);
  return withAgentLock(root, name, () => {
    const a = agent(root, name);
    const unread = readAll<Message>(root, "messages").filter(
      (m) => m.name > a.inbox_cursor && m.data.from !== name && (m.data.to === name || m.data.to === "*"),
    );
    if (!peek && unread.length) save(root, { ...a, inbox_cursor: unread.at(-1)!.name });
    return unread.map((m) => m.data);
  });
}

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

/** What an agent sees at the top of a turn. `full` adds identity + commands (session start). */
export function hookText(root: string, name: string, full: boolean): string {
  register(root, name); // last-seen + pid on every turn, so liveness never relies on message traffic
  const a = agent(root, name);
  const lines: string[] = [];
  if (full) {
    lines.push(
      `[mango] You are "${name}" in repo ${repoName(root)}. Report what you work on:`,
      `  ${CMD} --as ${name} start "task title #tag" | start t-id | note "what you did" | done "summary" | status blocked "why" | send <agent|*> "text"`,
    );
    const t = a.task && readOne<Task>(root, "tasks", a.task);
    if (t) lines.push(`[mango] Current task ${t.id}: ${t.title} (${a.status})`);
  }
  const msgs = inbox(root, name);
  if (msgs.length) {
    lines.push(`[mango] ${msgs.length} unread:`);
    for (const m of msgs) lines.push(`  ${hhmm(m.t)} ${m.from} → ${m.to === "*" ? "all" : "you"}: ${m.text}`);
  }
  return lines.join("\n");
}

const USAGE = `mango — agents self-report; you watch.
  mango --as <name> start "title #tag"|t-id | note "text" | done ["text"] | status working|blocked|idle ["why"]
  mango --as <name> send <agent|*> "text" | inbox [--peek]
  mango agents | forget <name> | hook <claude|codex|opencode> [--project] | serve [--port 4321]
Identity: --as <name> or MANGO_AGENT. Names like claude-ab12 set the tool glyph.`;

function parse(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && ["as", "hook", "port"].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

async function main(argv: string[]) {
  const { flags, rest } = parse(argv);
  const [verb, ...args] = rest;
  const text = (from: number) => args.slice(from).join(" ");

  if (verb === "inbox" && typeof flags.hook === "string") {
    // Hook mode: the adapter turns the harness's stdin into identity; the name comes from the session id.
    const adapter = adapterFor(flags.hook);
    const { session, cwd, full } = adapter.parseHookInput(await Bun.stdin.text(), process.cwd());
    setMeta({ cwd, session, pid: harnessPid(adapter.processNames), hook: true });
    const name = agentNameFor(adapter.tool, session, cwd);
    const out = hookText(findRoot(cwd), name, full);
    if (out) console.log(out);
    return;
  }

  const root = findRoot();
  const who = () => {
    const n = (typeof flags.as === "string" && flags.as) || process.env.MANGO_AGENT;
    if (!n) throw new Error("who are you? pass --as <name> or set MANGO_AGENT");
    return n;
  };

  switch (verb) {
    case "start": { const t = start(root, who(), text(0)); console.log(`now on ${t.id}: ${t.title}`); break; }
    case "note": note(root, who(), text(0)); console.log("noted"); break;
    case "done": done(root, who(), text(0) || undefined); console.log("done"); break;
    case "status": {
      const s = args[0] as Status;
      if (!["working", "blocked", "idle"].includes(s)) throw new Error("status must be working|blocked|idle");
      status(root, who(), s, text(1) || undefined); console.log(`status ${s}`); break;
    }
    case "send": send(root, who(), args[0], text(1)); console.log(`sent to ${args[0]}`); break;
    case "inbox": {
      const msgs = inbox(root, who(), flags.peek === true);
      console.log(msgs.length ? msgs.map((m) => `${hhmm(m.t)} ${m.from} → ${m.to}: ${m.text}`).join("\n") : "no unread");
      break;
    }
    case "agents": {
      const rows = readAll<Agent>(root, "agents").map((a) => a.data);
      console.log(rows.length ? rows.map((a) => `${a.name}\t${a.status}\t${a.task ?? "-"}\t${a.updated}`).join("\n") : "no agents yet");
      break;
    }
    case "forget": forget(root, args[0]); console.log(`forgot ${args[0]} (its tasks and messages stay)`); break;
    case "hook": {
      const adapter = adapterFor(args[0] ?? "");
      console.log(adapter.install(dirname(root), { global: !flags.project, command: `${CMD} inbox --hook ${adapter.tool}` }));
      break;
    }
    case "serve": { const { serve } = await import("./serve"); serve(root, Number(flags.port) || 4321); break; }
    default: console.log(USAGE); if (verb) process.exit(1);
  }
}

if (import.meta.main) main(process.argv.slice(2)).catch((e: Error) => { console.error(`mango: ${e.message}`); process.exit(1); });
