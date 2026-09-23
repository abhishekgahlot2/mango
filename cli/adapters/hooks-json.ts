import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HookInput } from "./types";

type HookFile = { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] }[]> };

/** Claude Code's hooks JSON shape, which Codex reuses: merge our two events in, idempotently. */
export function installHook(file: string, tool: string, command: string) {
  const cfg: HookFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  cfg.hooks ??= {};
  const entries: [string, string | undefined][] = [["SessionStart", "startup|resume|compact"], ["UserPromptSubmit", undefined]];
  for (const [event, matcher] of entries) {
    const list = (cfg.hooks[event] ??= []);
    if (list.some((e) => e.hooks.some((h) => h.command.includes(`inbox --hook ${tool}`)))) continue;
    list.push({ ...(matcher && { matcher }), hooks: [{ type: "command", command, timeout: 10 }] });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}

/** Claude Code's hook stdin: `{ session_id, cwd, hook_event_name, ... }`. Non-JSON counts as a session start. */
export function parseClaudeStyleInput(raw: string, fallbackCwd: string): HookInput {
  let ev: { session_id?: string; cwd?: string; hook_event_name?: string } = {};
  try { ev = JSON.parse(raw); } catch { /* not JSON */ }
  return { session: ev.session_id ?? null, cwd: ev.cwd ?? fallbackCwd, full: ev.hook_event_name !== "UserPromptSubmit" };
}
