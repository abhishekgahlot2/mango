import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { isValidRecordName, type BoardAgent } from "./store";

export type ActivityEvent = { id: string; t: string; repo: string; agent: string; kind: string; text: string };
export const projectDirName = (cwd: string) => cwd.replace(/[\\/:]/g, "-");

const TAIL_BYTES = 2 * 1024 * 1024;
const cache = new Map<string, { size: number; mtimeMs: number; events: ActivityEvent[] }>();

const text = (value: unknown): string => {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? ""; } catch { return String(value); }
};

const short = (value: unknown) => text(value).replace(/\s+/g, " ").trim().slice(0, 800);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function parseActivityLine(line: string, agent: BoardAgent): ActivityEvent[] {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return []; }
  if (!object(parsed)) return [];
  const row = parsed;
  const message = object(row.message) ? row.message : {};
  const blocks = Array.isArray(message.content) ? message.content : [message.content];
  return blocks.flatMap((block, i) => {
    let kind = "";
    let value: unknown;
    const rowType = typeof row.type === "string" ? row.type : "";
    if (typeof block === "string") [kind, value] = [rowType, block];
    else if (object(block) && block.type === "text") [kind, value] = [rowType, block.text];
    else if (object(block) && block.type === "tool_use") [kind, value] = ["tool_use", `${block.name ?? "tool"} ${text(block.input ?? "")}`];
    else if (object(block) && block.type === "tool_result") [kind, value] = ["tool_result", block.content];
    const valueText = short(value);
    if (!valueText || !["user", "assistant", "tool_use", "tool_result"].includes(kind)) return [];
    return [{
      id: `${agent.repo}/${agent.name}/${row.uuid ?? row.timestamp ?? "event"}/${i}`,
      t: typeof row.timestamp === "string" ? row.timestamp : agent.updated,
      repo: agent.repo,
      agent: agent.name,
      kind,
      text: valueText,
    }];
  });
}

export function parseCodexActivityLine(line: string, agent: BoardAgent): ActivityEvent[] {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return []; }
  if (!object(parsed) || parsed.type !== "response_item" || !object(parsed.payload)) return [];
  const payload = parsed.payload;
  let kind = "";
  let value: unknown;
  if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
    kind = payload.role;
    value = Array.isArray(payload.content)
      ? payload.content.filter(object).map((block) => block.text).filter((part) => typeof part === "string").join(" ")
      : "";
  } else if (payload.type === "function_call" || payload.type === "custom_tool_call") {
    kind = "tool_use";
    value = `${payload.name ?? "tool"} ${text(payload.arguments ?? payload.input ?? "")}`;
  } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    kind = "tool_result";
    value = payload.output;
  }
  const valueText = short(value);
  if (!valueText) return [];
  return [{
    id: `${agent.repo}/${agent.name}/${payload.id ?? parsed.timestamp ?? "event"}`,
    t: typeof parsed.timestamp === "string" ? parsed.timestamp : agent.updated,
    repo: agent.repo,
    agent: agent.name,
    kind,
    text: valueText,
  }];
}

function claudeTranscript(agent: BoardAgent, claudeRoot: string): string | null {
  if (!isAbsolute(agent.cwd) || (agent.session && !isValidRecordName(agent.session))) return null;
  const dir = join(claudeRoot, projectDirName(agent.cwd));
  if (!existsSync(dir)) return null;
  if (agent.session) {
    const exact = join(dir, `${agent.session}.jsonl`);
    if (existsSync(exact)) return exact;
  }
  const prefix = agent.name.startsWith("claude-") ? agent.name.slice(7) : "";
  if (!prefix) return null;
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

function codexTranscript(agent: BoardAgent, codexRoot: string): string | null {
  if (!agent.session || !isValidRecordName(agent.session)) return null;
  const dates = [new Date(agent.updated), new Date()];
  for (const date of dates) {
    for (const offset of [-1, 0, 1]) {
      const day = new Date(date.getTime() + offset * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "/");
      const dir = join(codexRoot, day);
      if (!existsSync(dir)) continue;
      const file = readdirSync(dir).find((name) => name.endsWith(`-${agent.session}.jsonl`));
      if (file) return join(dir, file);
    }
  }
  return null;
}

function readTail(path: string, agent: BoardAgent, parse: typeof parseActivityLine): ActivityEvent[] {
  const stat = statSync(path);
  const hit = cache.get(path);
  if (hit?.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.events;
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let body = buf.toString("utf8");
    if (start) body = body.slice(body.indexOf("\n") + 1);
    const events = body.split("\n").flatMap((line) => parse(line, agent)).slice(-200);
    cache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, events });
    return events;
  } finally {
    closeSync(fd);
  }
}

export function activityEvents(
  agents: BoardAgent[],
  claudeRoot = process.env.MANGO_CLAUDE_PROJECTS ?? join(homedir(), ".claude", "projects"),
  codexRoot = process.env.MANGO_CODEX_SESSIONS ?? join(homedir(), ".codex", "sessions"),
): ActivityEvent[] {
  return agents
    .filter((agent) => (agent.tool === "claude" && agent.cwd) || (agent.tool === "codex" && agent.session))
    .flatMap((agent) => {
      try {
        const path = agent.tool === "claude" ? claudeTranscript(agent, claudeRoot) : codexTranscript(agent, codexRoot);
        return path ? readTail(path, agent, agent.tool === "claude" ? parseActivityLine : parseCodexActivityLine) : [];
      } catch { return []; }
    })
    .toSorted((a, b) => a.t.localeCompare(b.t))
    .slice(-200);
}
