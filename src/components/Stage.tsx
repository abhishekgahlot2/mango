import { useEffect, useRef, useState } from "react";
import { ago, elapsed, glyphFor, hhmm, shortPath, type ActivityEvent, type Agent, type BoardMessage, type Task } from "@/board";
import { Chip } from "@/components/atoms/Chip";
import { StatusPill } from "@/components/atoms/StatusPill";
import { cn } from "@/lib/utils";
import { AgentGlyph } from "./AgentGlyph";
import ToolChips, { type ToolStep } from "./primitives/ToolChips";

const TONE = { working: "green", blocked: "orange", idle: "neutral" } as const;
const HOUR = 3_600_000;

function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="flex-1 rounded-card bg-surface px-3.5 py-2.5 shadow-card">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="flex items-baseline gap-2"><span className="text-[22px] font-semibold tracking-tight">{value}</span><span className="text-[12px] text-ink-2">{sub}</span></div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{children}</span>;
}

const ICON: Record<string, string> = { Edit: "write", Write: "write", MultiEdit: "write", NotebookEdit: "write", Bash: "run", Read: "read", Grep: "read", Glob: "read", WebFetch: "read", WebSearch: "read" };

/** A tool_use event → a ToolChips step: the tool name, the thing it touched, and its result as detail lines. */
function toStep(e: ActivityEvent, result?: ActivityEvent): ToolStep {
  const [tool, ...rest] = e.text.split(" ");
  let chip = rest.join(" ");
  try {
    const input = JSON.parse(chip) as Record<string, unknown>;
    chip = String(input.file_path ?? input.command ?? input.pattern ?? input.query ?? input.url ?? input.description ?? Object.values(input)[0] ?? "");
  } catch { /* not JSON: keep the raw text */ }
  const detail = (result?.text ?? "").split(/\s{2,}|\n/).filter(Boolean).slice(0, 6).map((text) => ({ text: text.slice(0, 120) }));
  return { icon: ICON[tool] ?? "think", label: `${tool} · ${hhmm(e.t)}`, chip: chip.slice(0, 90), mono: true, detailMono: true, detail };
}

type Turn = { kind: "text"; e: ActivityEvent } | { kind: "tools"; key: string; steps: ToolStep[] };

const stamp = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** A queued or done task: the one-line row opens into the full record (title, tags, timing, every note). */
function TaskItem({ t, now, done }: { t: Task; now: number; done: boolean }) {
  return (
    <li>
      <details className="group rounded-chip">
        <summary className="flex cursor-pointer list-none items-baseline gap-2 rounded-chip px-1.5 py-0.5 hover:bg-hover [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 font-mono text-[11px] text-ink-3">{done ? hhmm(t.ended!) : t.id}</span>
          <span className={cn("min-w-0 truncate text-ink-2 group-open:whitespace-normal group-open:text-ink", done && "line-through decoration-line-strong group-open:no-underline")}>{t.title}</span>
          {t.tags.map((tag) => <Chip key={tag} className="text-[10px]">#{tag}</Chip>)}
          <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-3">{done ? elapsed(t.started, Date.parse(t.ended!)) : hhmm(t.started)}</span>
        </summary>
        <div className="mx-1.5 mb-1.5 mt-1 rounded-control bg-inset px-3 py-2.5 text-[12px]">
          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-ink-3">
            <span>{t.id}</span>
            <span>started {stamp(t.started)}</span>
            {t.ended ? <span>done {stamp(t.ended)} · {elapsed(t.started, Date.parse(t.ended))}</span> : <span>open for {elapsed(t.started, now)}</span>}
          </div>
          {t.log.length ? (
            <ul className="mt-2 space-y-1 leading-[18px] text-ink-2">
              {t.log.map((l, i) => (
                <li key={i} className="flex gap-2"><span className="shrink-0 font-mono text-ink-3">{hhmm(l.t)}</span><span className="min-w-0 break-words">{l.text}</span></li>
              ))}
            </ul>
          ) : <div className="mt-2 text-ink-3">No notes.</div>}
        </div>
      </details>
    </li>
  );
}

/** Group a transcript into turns: runs of tool calls become one ToolChips block, text stays a row. */
function turns(events: ActivityEvent[]): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "tool_use") {
      const steps: ToolStep[] = [];
      const key = e.id;
      while (i < events.length && (events[i].kind === "tool_use" || events[i].kind === "tool_result")) {
        if (events[i].kind === "tool_use") steps.push(toStep(events[i], events[i + 1]?.kind === "tool_result" ? events[i + 1] : undefined));
        i++;
      }
      i--;
      out.push({ kind: "tools", key, steps });
    } else if (e.kind === "assistant" || (e.kind === "user" && !e.text.trimStart().startsWith("<"))) out.push({ kind: "text", e }); // "<…>" user rows are harness notifications, not the person
  }
  return out;
}

/** The selected agent: header, stats, current task, and its transcript activity. */
export function Stage({ agent, color, tasks, messages, events, unread, now, onDetails }: {
  agent: Agent; color: string; tasks: Task[]; messages: BoardMessage[]; events: ActivityEvent[]; unread: number; now: number; onDetails: () => void;
}) {
  const current = tasks.find((t) => t.id === agent.task && t.status === "open");
  const queued = tasks.filter((t) => t.status === "open" && t.id !== agent.task);
  const doneAll = tasks.filter((t) => t.status === "done").toSorted((a, b) => (b.ended! > a.ended! ? 1 : -1));
  const [showAllDone, setShowAllDone] = useState(false);
  const mine = events.filter((e) => e.repo === agent.repo && e.agent === agent.name);
  const recent = mine.slice(-120);
  const lastAt = mine.at(-1) ? Date.parse(mine.at(-1)!.t) : Date.parse(agent.updated);
  const liveNow = agent.alive !== false && now - lastAt < 60_000;
  const toolsLastHour = mine.filter((e) => e.kind === "tool_use" && now - Date.parse(e.t) < HOUR).length;
  const notesToday = tasks.flatMap((t) => t.log).filter((l) => new Date(l.t).toDateString() === new Date(now).toDateString()).length;
  const lastEvent = recent.at(-1);
  const pending = !!lastEvent && lastEvent.kind === "tool_use" && now - Date.parse(lastEvent.t) < 60_000;
  const grouped = turns(recent);

  const stream = useRef<HTMLUListElement>(null);
  useEffect(() => { stream.current?.scrollTo({ top: stream.current.scrollHeight }); }, [recent.length, agent.name]);

  return (
    <section className="flex min-h-[600px] flex-1 shrink-0 flex-col gap-3">
      <header className="flex items-center gap-3.5 rounded-card bg-surface px-4 py-3 shadow-card">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-surface text-ink shadow-btn">
          <AgentGlyph glyph={glyphFor(agent.name)} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[16px] font-semibold">{agent.tool} · {agent.cwd.split("/").at(-1) || agent.repo}</span>
            <StatusPill tone={agent.alive === false ? "neutral" : TONE[agent.status]}>{agent.alive === false ? "ended" : agent.status}</StatusPill>
            <span className={cn("flex items-center gap-1.5 text-[12px]", liveNow ? "text-green" : "text-ink-3")}>
              <span className={cn("size-[7px] rounded-full", liveNow ? "bg-green shadow-[0_0_0_4px_var(--green-tint)]" : "bg-ink-3")} />
              {liveNow ? `live · ${ago(new Date(lastAt).toISOString(), now)}` : `quiet · ${elapsed(new Date(lastAt).toISOString(), now)}`}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-3" title={agent.cwd}>
            {agent.cwd ? shortPath(agent.cwd) : "directory unknown"}{agent.branch && <> · <span className="text-ink-2">{agent.branch}</span></>} · <code className="font-mono text-ink-2">{agent.name}</code>
            {agent.session && <> · session {agent.session.slice(0, 8)}</>}{agent.pid && <> · pid {agent.pid}</>}
          </div>
        </div>
        <button type="button" onClick={onDetails} className="h-[30px] shrink-0 rounded-full bg-surface px-3 text-[13px] text-ink shadow-btn hover:bg-inset focus-visible:outline-2 focus-visible:outline-accent">Details</button>
      </header>

      <div className="flex gap-3">
        <Stat label="Open tasks" value={tasks.filter((t) => t.status === "open").length} sub={current ? "1 current" : "none current"} />
        <Stat label="Notes today" value={notesToday} sub={tasks.flatMap((t) => t.log).at(-1) ? `last ${elapsed(tasks.flatMap((t) => t.log).toSorted((a, b) => (a.t < b.t ? 1 : -1))[0].t, now)} ago` : "—"} />
        <Stat label="Messages" value={messages.filter((m) => m.from === agent.name || m.to === agent.name || m.to === "*").length} sub={`${unread} unread`} />
        <Stat label="Tool calls / hour" value={toolsLastHour} sub={mine.length ? `${mine.length} events` : "no transcript"} />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-[400px] shrink-0 flex-col gap-3 overflow-y-auto rounded-card bg-surface px-4 py-3.5 shadow-card">
          <div className="flex items-center gap-2.5">
            <Label>Tasks</Label>
            <span className="text-[12px] text-ink-3">{current ? 1 : 0} now · {queued.length} queued · {doneAll.length} done</span>
          </div>

          <section>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-3"><span className={cn("size-1.5 rounded-full", current ? (agent.status === "blocked" ? "bg-orange" : "bg-green") : "bg-ink-3")} />Now</h4>
            {current ? (
              <div className="rounded-control bg-inset px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 break-words text-[13px] font-semibold">{current.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-ink-3">{current.id} · {elapsed(current.started, now)}</span>
                </div>
                {current.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{current.tags.map((tag) => <Chip key={tag}>#{tag}</Chip>)}</div>}
                <ul className="mt-1.5 space-y-1 text-[12px] leading-[18px] text-ink-2">
                  {current.log.map((l, i) => (
                    <li key={i} className="flex gap-2"><span className="shrink-0 font-mono text-ink-3">{hhmm(l.t)}</span><span className="min-w-0 break-words">{l.text}</span></li>
                  ))}
                  {current.log.length === 0 && <li className="text-ink-3">No notes yet.</li>}
                </ul>
              </div>
            ) : (
              <div className="rounded-control bg-inset px-3 py-2.5 text-[12px] text-ink-3">Nothing in progress.</div>
            )}
          </section>

          <details open>
            <summary className="mb-1.5 flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-ink-3"><span className="size-1.5 rounded-full border border-ink-3" />Queued · {queued.length}</summary>
            {queued.length ? (
              <ul className="space-y-0.5 text-[12px]">
                {queued.map((t) => <TaskItem key={t.id} t={t} now={now} done={false} />)}
              </ul>
            ) : <div className="px-1.5 text-[12px] text-ink-3">Empty.</div>}
          </details>

          <details open={!current}>
            <summary className="mb-1.5 flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-medium text-ink-3"><span className="text-[10px] leading-none text-green">✓</span>Done · {doneAll.length}</summary>
            {doneAll.length ? (
              <ul className="space-y-0.5 text-[12px]">
                {doneAll.slice(0, showAllDone ? undefined : 6).map((t) => <TaskItem key={t.id} t={t} now={now} done />)}
                {doneAll.length > 6 && (
                  <li><button type="button" onClick={() => setShowAllDone((v) => !v)} className="px-1.5 text-[12px] text-accent-ink hover:underline">{showAllDone ? "Show fewer" : `Show all ${doneAll.length}`}</button></li>
                )}
              </ul>
            ) : <div className="px-1.5 text-[12px] text-ink-3">Nothing finished yet.</div>}
          </details>

          {unread > 0 && <div><Chip tone="accent">{unread} unread</Chip></div>}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-card bg-surface px-4 py-3.5 shadow-card">
          <div className="flex items-center gap-2.5"><Label>Activity</Label><span className="text-[12px] text-ink-3">from the session transcript</span></div>
          <ul ref={stream} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {grouped.map((g) =>
              g.kind === "text" ? (
                <li key={g.e.id} className="flex gap-3 text-[13px] leading-5">
                  <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-ink-3">{hhmm(g.e.t)}</span>
                  <span className={cn("min-w-0 break-words", g.e.kind === "user" ? "text-ink-2" : "text-ink")}>{g.e.kind === "user" && <span className="mr-1.5 text-ink-3">you:</span>}{g.e.text.slice(0, 600)}</span>
                </li>
              ) : (
                <li key={g.key} className="pl-[60px]">
                  <ToolChips steps={g.steps} diffs={[]} diffLines={{}} labels={{ header: `${g.steps.length} tool call${g.steps.length === 1 ? "" : "s"}`, more: "" }} />
                </li>
              ),
            )}
            {pending && <li className="flex gap-3 pl-[60px] text-[12px]"><span className="size-2 translate-y-1 rounded-full" style={{ background: color }} /><span className="shimmer-text">working…</span></li>}
            {recent.length === 0 && <li className="py-6 text-center text-[12px] text-ink-3">No transcript found for this session yet.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}
