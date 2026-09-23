import { useEffect, useRef } from "react";
import { elapsed, glyphFor, hhmm, useNow, type Agent, type BoardMessage, type Task } from "@/board";
import { StatusPill } from "@/components/atoms/StatusPill";
import { AgentGlyph } from "./AgentGlyph";

const TONE = { working: "green", blocked: "orange", idle: "neutral" } as const;
const stamp = (iso: string) => new Date(iso).toLocaleString();

function TaskBlock({ task, now }: { task: Task; now: number }) {
  return (
    <li className="rounded-control bg-inset p-3">
      <div className="flex items-baseline gap-2 text-[13px]">
        <code className="shrink-0 font-mono text-ink-3">{task.id}</code>
        <span className="min-w-0 break-words font-medium">{task.title}</span>
        <span className="ml-auto shrink-0 font-mono text-[12px] tabular-nums text-ink-3">
          {hhmm(task.started)} · {elapsed(task.started, task.ended ? Date.parse(task.ended) : now)}
        </span>
      </div>
      {task.log.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px] text-ink-2">
          {task.log.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 font-mono tabular-nums text-ink-3">{hhmm(l.t)}</span>
              <span className="min-w-0 break-words">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

/** Everything about one agent, in a modal. Esc, the backdrop, or the close button dismiss it. */
export function AgentDetail({ agent, tasks, messages, onClose }: { agent: Agent; tasks: Task[]; messages: BoardMessage[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const now = useNow();
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.focus();
  }, []);

  const current = tasks.find((t) => t.id === agent.task && t.status === "open");
  const queued = tasks.filter((t) => t.status === "open" && t.id !== agent.task);
  const done = tasks.filter((t) => t.status === "done").toSorted((a, b) => (b.ended! > a.ended! ? 1 : -1));
  const mine = messages.filter((m) => m.from === agent.name || m.to === agent.name || m.to === "*").toReversed();
  const meta: [string, string][] = [
    ["Repo", agent.repo],
    ["Tool", agent.tool],
    ["Handle", agent.name],
    ["Directory", agent.cwd || "unknown"],
    ["Branch", agent.branch ?? "—"],
    ["Session", agent.session ?? "—"],
    ["Process", agent.pid ? `${agent.pid} · ${agent.alive ? "running" : "ended"}` : "— (not captured yet)"],
    ["Last update", stamp(agent.updated)],
    ["Cursor", agent.inbox_cursor || "— (nothing read yet)"],
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      tabIndex={-1}
      className="m-auto w-[min(760px,calc(100vw-2rem))] max-h-[88dvh] overflow-auto rounded-window bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-5 p-5">
        <header className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface text-ink shadow-btn">
            <AgentGlyph glyph={glyphFor(agent.name)} className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-semibold">{agent.tool} · {agent.cwd.split("/").at(-1) || agent.name}</h2>
            <div className="text-[12px] text-ink-3">{agent.status} · {elapsed(agent.updated, now)} since last update</div>
          </div>
          <StatusPill tone={TONE[agent.status]} className="shrink-0">{agent.status}</StatusPill>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="ml-1 size-8 rounded-full text-ink-2 hover:bg-hover">×</button>
        </header>

        <Section title="Record">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {meta.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd className="min-w-0 break-all font-mono text-[12px] text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Current task">
          {current ? <ul><TaskBlock task={current} now={now} /></ul> : <p className="text-[13px] text-ink-3">No open task.</p>}
        </Section>

        {queued.length > 0 && (
          <Section title={`Queued · ${queued.length}`}>
            <ul className="space-y-2">{queued.map((t) => <TaskBlock key={t.id} task={t} now={now} />)}</ul>
          </Section>
        )}

        {done.length > 0 && (
          <Section title={`Done · ${done.length}`}>
            <ul className="space-y-2">{done.map((t) => <TaskBlock key={t.id} task={t} now={now} />)}</ul>
          </Section>
        )}

        <Section title={`Messages · ${mine.length}`}>
          {mine.length ? (
            <ul className="space-y-1 text-[13px]">
              {mine.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-3">{hhmm(m.t)}</span>
                  <span className="shrink-0 text-ink-2">{m.from === agent.name ? "→ " + (m.to === "*" ? "everyone" : m.to) : "← " + m.from}</span>
                  <span className="min-w-0 break-words">{m.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">None yet.</p>
          )}
        </Section>
      </div>
    </dialog>
  );
}
