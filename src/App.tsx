import { useState } from "react";
import { ago, agentKey, glyphFor, unreadCount, useBoard, useNow } from "@/board";
import { AgentGlyph } from "@/components/AgentGlyph";
import { AgentCard } from "@/components/AgentCard";
import { AgentDetail } from "@/components/AgentDetail";
import { ActivityLog } from "@/components/ActivityLog";
import { cn } from "@/lib/utils";

const ORDER = { working: 0, blocked: 1, idle: 2 } as const;

export function App() {
  const { board, connected } = useBoard();
  const now = useNow();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    try { localStorage.setItem("mango-theme", next ? "dark" : "light"); } catch { /* preference is optional */ }
  };
  // The open detail view lives in the URL hash, so a card view is linkable: /#a2a/claude-ab12
  const [selected, setSelected] = useState(() => decodeURIComponent(location.hash.slice(1)) || null);
  const open = (key: string | null) => {
    history.replaceState(null, "", key ? `#${key}` : location.pathname);
    setSelected(key);
  };
  const detail = selected ? board.agents.find((a) => agentKey(a) === selected) : undefined;
  const openCount = board.tasks.filter((t) => t.status === "open").length;
  const doneCount = board.tasks.length - openCount;
  const rank = (a: (typeof board.agents)[number]) => (a.alive === false ? 3 : ORDER[a.status]);
  const agents = board.agents.toSorted((a, b) => rank(a) - rank(b) || (b.updated > a.updated ? 1 : -1));
  // Ended = harness process gone; records without a pid (written before the hook captured one) count as ended after an hour of silence.
  const isEnded = (a: (typeof agents)[number]) => a.alive === false || (a.alive === null && now - Date.parse(a.updated) > 3_600_000);
  const live = agents.filter((a) => !isEnded(a));
  const ended = agents.filter(isEnded);

  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-canvas p-4 sm:p-6">
      <>
        <header className="flex items-center justify-between rounded-card bg-surface py-2.5 pl-4 pr-4 shadow-card">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[20px] font-semibold tracking-tight">mango</h1>
            <span className="text-[13px] text-ink-2">{board.repos.join(" · ")}</span>
          </div>
          <div className="flex items-center gap-4">
            <button type="button" onClick={toggleTheme} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
              className="rounded-control bg-inset px-2.5 py-1 text-[12px] text-ink-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
              {dark ? "Light" : "Dark"}
            </button>
            <span className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className={cn("size-2 rounded-full", connected ? "bg-green" : "bg-red")} />
              {connected ? "live" : "disconnected"}
            </span>
          </div>
        </header>

        <p className="text-[13px] text-ink-2">
          {live.length} agents · {openCount} open · {doneCount} done
        </p>

        {live.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {live.map((a) => (
              <AgentCard key={agentKey(a)} agent={a} tasks={board.tasks.filter((t) => t.repo === a.repo && t.agent === a.name)} unread={unreadCount(a, board)} now={now} onOpen={() => open(agentKey(a))} />
            ))}
          </ul>
        ) : (
          <section className="rounded-card bg-surface p-6 text-center text-[13px] text-ink-2 shadow-card">
            No agents yet. In this repo run <code className="font-mono">bun cli/mango.ts hook claude</code>, then start a Claude Code session.
          </section>
        )}

        {ended.length > 0 && (
          <details className="rounded-card bg-surface px-3.5 py-2 text-[13px] shadow-card">
            <summary className="cursor-pointer select-none text-ink-2">Ended sessions · {ended.length}</summary>
            <ul className="mt-2 divide-y divide-line">
              {ended.map((a) => (
                <li key={agentKey(a)}>
                  <button type="button" onClick={() => open(agentKey(a))} className="flex w-full items-center gap-3 py-1.5 text-left hover:bg-hover">
                    <AgentGlyph glyph={glyphFor(a.name)} className="size-4 shrink-0 text-ink-3" />
                    <code className="font-mono text-[12px] text-ink-2">{a.name}</code>
                    <span className="truncate text-ink-3">{a.cwd.replace(/^\/(Users|home)\/[^/]+/, "~")}</span>
                    <span className="ml-auto shrink-0 text-ink-3">{ago(a.updated, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ActivityLog />
        {detail && (
          <AgentDetail key={agentKey(detail)} agent={detail} tasks={board.tasks.filter((t) => t.repo === detail.repo && t.agent === detail.name)} messages={board.messages.filter((m) => m.repo === detail.repo)} onClose={() => open(null)} />
        )}
      </>
    </main>
  );
}
