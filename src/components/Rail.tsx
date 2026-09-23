import { ago, agentKey, glyphFor, shortPath, type Agent, type Task } from "@/board";
import { StatusPill } from "@/components/atoms/StatusPill";
import { ValuePill } from "@/components/atoms/ValuePill";
import { cn } from "@/lib/utils";
import { AgentGlyph } from "./AgentGlyph";

const TONE = { working: "green", blocked: "orange", idle: "neutral" } as const;

/** Left rail: brand, repo filter, one neutral row per live agent, ended sessions collapsed, theme toggle. */
export function Rail({ live, ended, tasks, repos, repo, colorOf, tags, tag, selected, now, dark, onSelect, onRepo, onTag, onTheme }: {
  live: Agent[]; ended: Agent[]; tasks: Task[]; repos: string[]; repo: string | null; colorOf: (repo: string) => string; tags: string[]; tag: string | null;
  selected: string | null; now: number; dark: boolean; onSelect: (key: string) => void; onRepo: (repo: string | null) => void; onTag: (tag: string | null) => void; onTheme: () => void;
}) {
  const current = (a: Agent) => tasks.find((t) => t.repo === a.repo && t.agent === a.name && t.id === a.task && t.status === "open");
  const queued = (a: Agent) => tasks.filter((t) => t.repo === a.repo && t.agent === a.name && t.status === "open" && t.id !== a.task).length;
  const chip = (label: string, on: boolean, onClick: () => void, dot?: string) => (
    <button key={label} type="button" onClick={onClick} aria-pressed={on}
      className={cn("flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px]", on ? "bg-ink text-canvas" : "text-ink-2 shadow-hairline hover:bg-hover")}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}{label}
    </button>
  );
  return (
    <aside className="flex w-full shrink-0 flex-col gap-1 border-b border-line bg-surface p-3 md:h-dvh md:w-[300px] md:border-b-0 md:border-r">
      <div className="flex items-baseline gap-2.5 px-2 pb-2 pt-1">
        <h1 className="text-[20px] font-semibold tracking-tight">mango</h1>
        <span className="text-[12px] text-ink-3">{live.length} live · {tasks.filter((t) => t.status === "open").length} open · {tasks.filter((t) => t.status === "done").length} done</span>
      </div>
      {repos.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          {chip("All", repo === null, () => onRepo(null))}
          {repos.map((r) => chip(r, repo === r, () => onRepo(r), colorOf(r)))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => onTag(tag === t ? null : t)} aria-pressed={tag === t}
              className={cn("rounded-chip px-1.5 py-0.5 font-mono text-[11px]", tag === t ? "bg-ink text-canvas" : "bg-inset text-ink-2 hover:bg-hover")}>#{t}</button>
          ))}
        </div>
      )}
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {live.map((a) => {
          const t = current(a);
          const key = agentKey(a);
          return (
            <li key={key}>
              <button type="button" onClick={() => onSelect(key)} aria-current={selected === key ? "true" : undefined}
                className={cn("relative flex w-full flex-col gap-1.5 rounded-control py-2 pl-4 pr-2.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent", selected === key && "bg-hover")}>
                <span aria-hidden="true" className="absolute bottom-2 left-1 top-2 w-[3px] rounded-full" style={{ background: colorOf(a.repo) }} />
                <span className="flex items-center gap-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-chip bg-surface text-ink shadow-btn">
                    <AgentGlyph glyph={glyphFor(a.name)} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{a.tool} · {a.cwd.split("/").at(-1) || a.repo}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">{a.name} · {ago(a.updated, now)}</span>
                  </span>
                  <StatusPill tone={TONE[a.status]} className="shrink-0 h-5 text-[11px]">{a.status}</StatusPill>
                </span>
                <span className="flex items-baseline gap-2 text-[12px]">
                  <span className={cn("min-w-0 truncate", t ? "text-ink-2" : "text-ink-3")}>{t ? t.title : "No open task"}</span>
                  {queued(a) > 0 && <ValuePill className="ml-auto shrink-0 text-[11px]">+{queued(a)} queued</ValuePill>}
                </span>
              </button>
            </li>
          );
        })}
        {live.length === 0 && (
          <li className="px-2.5 py-6 text-center text-[12px] text-ink-3">No live agents. Run <code className="font-mono">mango hook claude</code> and start a session.</li>
        )}
      </ul>
      {ended.length > 0 && (
        <details className="border-t border-line pt-2 text-[12px]">
          <summary className="cursor-pointer select-none px-2.5 py-1 text-ink-3">Ended · {ended.length}</summary>
          <ul className="mt-1">
            {ended.map((a) => (
              <li key={agentKey(a)}>
                <button type="button" onClick={() => onSelect(agentKey(a))} className="flex w-full items-center gap-2 rounded-control px-2.5 py-1 text-left hover:bg-hover">
                  <AgentGlyph glyph={glyphFor(a.name)} className="size-3.5 shrink-0 text-ink-3" />
                  <code className="font-mono text-ink-2">{a.name}</code>
                  <span className="truncate text-ink-3">{shortPath(a.cwd)}</span>
                  <span className="ml-auto shrink-0 text-ink-3">{ago(a.updated, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex items-center justify-between border-t border-line px-2.5 pt-2 text-[12px] text-ink-3">
        <span>v0.1</span>
        <button type="button" onClick={onTheme} className="rounded-chip px-2 py-0.5 text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
          {dark ? "Light" : "Dark"} theme
        </button>
      </div>
    </aside>
  );
}
