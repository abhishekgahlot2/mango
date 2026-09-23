import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export type Status = "working" | "blocked" | "idle";
export type Agent = {
  name: string; tool: string; status: Status; task: string | null; updated: string; inbox_cursor: string;
  cwd: string; branch: string | null; session: string | null;
  /** Harness process id, captured by the hook; the board checks whether it is still running. */
  pid: number | null;
};
/** Agent as the board sees it: `alive` is null when no pid was ever captured; `repo` keys it across stores. */
export type BoardAgent = Agent & { alive: boolean | null; repo: string };
export type Task = { id: string; agent: string; title: string; tags: string[]; status: "open" | "done"; log: { t: string; text: string }[]; started: string; ended: string | null };
export type Message = { t: string; from: string; to: string; text: string };
export type Snapshot = {
  repos: string[];
  agents: BoardAgent[];
  tasks: (Task & { repo: string })[];
  messages: (Message & { id: string; repo: string })[];
};

type Kind = "agents" | "tasks" | "messages";
export const isValidRecordName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);

function nearest(cwd: string, marker: string): string | null {
  for (let d = cwd; ; d = dirname(d)) {
    if (existsSync(join(d, marker))) return d;
    if (dirname(d) === d) return null;
  }
}

/** A worktree's `.git` is a file pointing at `<main>/.git/worktrees/<name>`; map it back to `<main>`. */
function mainWorktree(repo: string): string {
  const dotGit = join(repo, ".git");
  if (statSync(dotGit).isDirectory()) return repo;
  const m = /gitdir:\s*(.+)/.exec(readFileSync(dotGit, "utf8"));
  const wt = m && /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(m[1].trim());
  return wt ? wt[1] : repo;
}

/** MANGO_DIR, else nearest ancestor with .mango/, else the git repo (worktrees resolve to the main checkout), else cwd. */
export function findRoot(cwd = process.cwd()): string {
  if (process.env.MANGO_DIR) return process.env.MANGO_DIR;
  const local = nearest(cwd, ".mango");
  if (local) return join(local, ".mango");
  const repo = nearest(cwd, ".git");
  return join(repo ? mainWorktree(repo) : cwd, ".mango");
}

/** Current branch at `cwd`, read from .git/HEAD without spawning git. Null when unknown or detached. */
export function branchOf(cwd: string): string | null {
  try {
    const repo = nearest(cwd, ".git");
    if (!repo) return null;
    const dotGit = join(repo, ".git");
    const gitDir = statSync(dotGit).isDirectory() ? dotGit : /gitdir:\s*(.+)/.exec(readFileSync(dotGit, "utf8"))![1].trim();
    return /^ref: refs\/heads\/(.+)$/m.exec(readFileSync(join(gitDir, "HEAD"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

export const repoName = (root: string) => basename(dirname(root));
export function agentNameFor(tool: string, session: string | null, cwd: string): string {
  const source = session?.slice(0, 4) ?? basename(cwd);
  const suffix = source.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 48) || "workspace";
  return `${tool}-${suffix}`;
}
export const now = () => new Date().toISOString();
export const shortId = () => randomUUID().replaceAll("-", "").slice(0, 12);
let seq = 0;
/** Sortable filename for a message: ISO time, a per-process sequence (same-ms order), a nonce (cross-process). */
export const messageName = (t: string) => `${t.replace(/[:.]/g, "-")}-${String(seq++).padStart(4, "0")}-${shortId()}`;

/** Every store ever written to, one path per line, so one board can show every repo. */
export const registryPath = () => process.env.MANGO_REGISTRY ?? join(homedir(), ".config", "mango", "roots");

export function knownRoots(): string[] {
  const file = registryPath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((r) => r && existsSync(r));
}

function registerRoot(root: string) {
  if (knownRoots().includes(root)) return;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), `${root}\n`, { flag: "a" });
}

export function write(root: string, kind: Kind, name: string, data: unknown) {
  if (!isValidRecordName(name)) throw new Error(`invalid record name: ${name}`);
  const dir = join(root, kind);
  mkdirSync(dir, { recursive: true });
  registerRoot(root);
  const tmp = join(dir, `.${name}.${process.pid}.${shortId()}.tmp`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, join(dir, `${name}.json`)); // atomic on POSIX
}

export function readOne<T>(root: string, kind: Kind, name: string): T | null {
  if (!isValidRecordName(name)) throw new Error(`invalid record name: ${name}`);
  const p = join(root, kind, `${name}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/** All records of a kind, sorted by filename. Files with bad JSON are skipped with a warning. */
export function readAll<T>(root: string, kind: Kind): { name: string; data: T }[] {
  const dir = join(root, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .toSorted()
    .flatMap((f) => {
      try {
        return [{ name: f.slice(0, -5), data: JSON.parse(readFileSync(join(dir, f), "utf8")) as T }];
      } catch (e) {
        console.error(`mango: skipping ${kind}/${f}: ${(e as Error).message}`);
        return [];
      }
    });
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, not ours
  }
}

export function snapshot(root: string): Snapshot {
  const repo = repoName(root);
  const tasks = readAll<Partial<Task>>(root, "tasks").map((t) => ({ tags: [], ...t.data, repo }) as Task & { repo: string });
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return {
    repos: [repo],
    // Records may predate a field or be hand-edited; fill defaults so the board never trips on a missing key.
    agents: readAll<Partial<Agent>>(root, "agents").map((a) => {
      const agent = { cwd: "", branch: null, session: null, pid: null, ...a.data } as Agent;
      const current = agent.task && taskById.get(agent.task);
      const coherent = agent.task && (!current || current.status !== "open" || current.agent !== agent.name)
        ? { ...agent, task: null, status: "idle" as const } : agent;
      return { ...coherent, alive: agent.pid ? isRunning(agent.pid) : null, repo };
    }),
    tasks,
    messages: readAll<Message>(root, "messages").map((m) => ({ ...m.data, id: m.name, repo })).slice(-500),
  };
}

/** One board over several stores. Message ids start with the timestamp, so a global sort is chronological. */
export function snapshotAll(roots: string[]): Snapshot {
  const parts = roots.map(snapshot);
  return {
    repos: parts.flatMap((s) => s.repos),
    agents: parts.flatMap((s) => s.agents),
    tasks: parts.flatMap((s) => s.tasks),
    messages: parts.flatMap((s) => s.messages).toSorted((a, b) => (a.id < b.id ? -1 : 1)).slice(-500),
  };
}
