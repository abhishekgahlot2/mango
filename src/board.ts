import { useEffect, useRef, useState } from "react";
import type { Glyph } from "@/components/AgentGlyph";
import type { BoardAgent, Snapshot } from "../cli/store";

export type { BoardAgent as Agent, Message, Snapshot } from "../cli/store";
export type Task = Snapshot["tasks"][number];
/** A message as the board sees it: the store record plus its sortable id. */
export type BoardMessage = Snapshot["messages"][number];

const EMPTY: Snapshot = { repos: [], agents: [], tasks: [], messages: [] };

/** Live snapshot over SSE from `mango serve`. */
export function useBoard(): { board: Snapshot; connected: boolean } {
  const [board, setBoard] = useState(EMPTY);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      setConnected(true);
      setBoard(JSON.parse(e.data));
    };
    return () => es.close();
  }, []);
  return { board, connected };
}

/** True for `ms` after `stamp` changes; false on mount. */
export function useFlash(stamp: string, ms = 550): boolean {
  const [on, setOn] = useState(false);
  const prev = useRef(stamp);
  useEffect(() => {
    if (prev.current === stamp) return;
    prev.current = stamp;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [stamp, ms]);
  return on;
}

/** Re-renders every `ms`, for elapsed-time labels. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const GLYPH: Record<string, Glyph> = { claude: "burst", codex: "blob", opencode: "cube" };
export const glyphFor = (name: string): Glyph => GLYPH[name.split("-")[0]] ?? "pixel";

export const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

export function elapsed(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const agentKey = (a: { repo: string; name: string }) => `${a.repo}/${a.name}`;

export const unreadCount = (a: BoardAgent, board: Snapshot) =>
  board.messages.filter((m) => m.repo === a.repo && m.id > a.inbox_cursor && m.from !== a.name && (m.to === a.name || m.to === "*")).length;

export function ago(iso: string, now: number): string {
  const e = elapsed(iso, now);
  return e === "now" ? "just now" : `${e} ago`;
}

/** One colour per project (BoardUI's chart ramp), handed out in name order: rail stripe, repo chip, timeline lane. */
const RAMP = ["#0ea5e9", "#ec4899", "#a855f7", "#84cc16", "#14b8a6", "#f59e0b", "#6366f1", "#f43f5e"];
export function repoColors(repos: string[]): Map<string, string> {
  return new Map(repos.toSorted().map((r, i) => [r, RAMP[i % RAMP.length]]));
}

export type ActivityEvent = { id: string; t: string; repo: string; agent: string; kind: string; text: string };

/** Transcript activity for one agent (`repo/name`), streamed from `/api/activity`; the server filters, so many agents cost nothing extra. */
export function useActivity(key: string | null): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    setEvents([]);
    if (!key) return;
    const es = new EventSource(`/api/activity?agent=${encodeURIComponent(key)}`);
    es.onmessage = (e) => setEvents((JSON.parse(e.data) as { events: ActivityEvent[] }).events);
    return () => es.close();
  }, [key]);
  return events;
}

export const shortPath = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");
/** What the agent is doing, from evidence: a self-reported block wins, then a transcript written in the last 60s, then the self-reported status. */
export type Shown = "blocked" | "active" | "working" | "idle" | "ended";
export function shownStatus(a: BoardAgent, now: number): Shown {
  if (isEnded(a, now)) return "ended";
  if (a.status === "blocked") return "blocked";
  if (a.activeAt && now - Date.parse(a.activeAt) < 60_000) return "active";
  return a.status;
}
export const isEnded = (a: BoardAgent, now: number) => a.alive === false || (a.alive === null && now - Date.parse(a.updated) > 3_600_000);

/** A collapsible panel's open state, remembered per viewer in localStorage (best effort). */
export function useOpen(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(`mango-open-${key}`); return v === null ? initial : v === "1"; } catch { return initial; }
  });
  const set = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(`mango-open-${key}`, v ? "1" : "0"); } catch { /* optional */ }
  };
  return [open, set];
}

export const isCurrentTask = (s: Task["status"]) => s === "running" || s === "review" || s === "blocked";
