import { ago, elapsed, glyphFor, hhmm, useFlash, type Agent, type Task } from "@/board";
import { Chip } from "@/components/atoms/Chip";
import { StatusPill } from "@/components/atoms/StatusPill";
import { cn } from "@/lib/utils";
import { AgentGlyph } from "./AgentGlyph";

const TONE = { working: "green", blocked: "orange", idle: "neutral" } as const;

/** `/Users/x/Desktop/a2a` → `~/Desktop/a2a` */
const shortPath = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~");

function Log({ log }: { log: Task["log"] }) {
  if (!log.length) return null;
  return (
    <ul className="mt-1.5 max-h-80 space-y-1 overflow-y-auto text-[12px] text-ink-2">
      {log.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 font-mono tabular-nums text-ink-3">{hhmm(l.t)}</span>
          <span className="min-w-0 break-words">{l.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One agent: glyph tile (inverts briefly on every update), status, open task with its full log,
 *  unread count, and the agent's finished tasks behind a disclosure. */
export function AgentCard({ agent, tasks, unread, now, onOpen }: { agent: Agent; tasks: Task[]; unread: number; now: number; onOpen: () => void }) {
  const flash = useFlash(agent.updated);
  const open = tasks.find((t) => t.id === agent.task && t.status === "open");
  const queued = tasks.filter((t) => t.status === "open" && t.id !== agent.task);
  const done = tasks.filter((t) => t.status === "done").toSorted((a, b) => (b.ended! > a.ended! ? 1 : -1));
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpen}
          title="Open details"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
        >
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-control shadow-btn",
            flash ? "bg-ink text-canvas" : "bg-surface text-ink",
          )}
        >
          <AgentGlyph glyph={glyphFor(agent.name)} className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">
            {agent.tool} · {agent.cwd.split("/").at(-1) || agent.name}
          </div>
          <div className="truncate text-[12px] text-ink-3" title={agent.cwd}>
            {agent.cwd ? shortPath(agent.cwd) : "directory unknown"}
            {agent.branch && <> · <span className="text-ink-2">{agent.branch}</span></>}
          </div>
          <div className="text-[12px] text-ink-3">
            <code className="font-mono text-ink-2" title={agent.session ?? undefined}>{agent.name}</code> · {ago(agent.updated, now)}
          </div>
        </div>
        </button>
        <StatusPill tone={TONE[agent.status]} className="shrink-0">{agent.status}</StatusPill>
      </div>

      {open ? (
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 break-words text-[13px] font-medium">{open.title}</span>
            <span className="ml-auto shrink-0 font-mono text-[12px] tabular-nums text-ink-3">{elapsed(open.started, now)}</span>
          </div>
          <Log log={open.log} />
        </div>
      ) : (
        <div className="text-[13px] text-ink-3">No open task</div>
      )}

      {queued.length > 0 && (
        <div className="min-w-0 text-[12px]">
          <div className="text-ink-3">Queued · {queued.length}</div>
          <ul className="mt-1 space-y-0.5 text-ink-2">
            {queued.map((t) => (
              <li key={t.id} className="flex gap-2">
                <code className="shrink-0 font-mono text-ink-3">{t.id}</code>
                <span className="min-w-0 truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unread > 0 && (
        <div>
          <Chip tone="accent">{unread} unread</Chip>
        </div>
      )}

      {done.length > 0 && (
        <details className="min-w-0 border-t border-line pt-2 text-[13px]">
          <summary className="cursor-pointer select-none text-ink-2">{done.length} done</summary>
          <ul className="mt-2 space-y-3">
            {done.map((t) => (
              <li key={t.id} className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 break-words font-medium">{t.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[12px] tabular-nums text-ink-3">
                    {hhmm(t.started)} · {elapsed(t.started, Date.parse(t.ended!))}
                  </span>
                </div>
                <Log log={t.log} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
