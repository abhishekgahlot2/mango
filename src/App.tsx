import { useState } from "react";
import { agentKey, isEnded, repoColors, unreadCount, useActivity, useBoard, useNow, type Agent } from "@/board";
import { AgentDetail } from "@/components/AgentDetail";
import { Rail } from "@/components/Rail";
import { Stage } from "@/components/Stage";
import { Timeline } from "@/components/Timeline";

const ORDER = { working: 0, blocked: 1, idle: 2 } as const;

export function App() {
  const { board, connected } = useBoard();
  const now = useNow(15_000);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    try { localStorage.setItem("mango-theme", next ? "dark" : "light"); } catch { /* preference is optional */ }
  };
  const [repo, setRepo] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const tags = [...new Set(board.tasks.flatMap((t) => t.tags))].toSorted();
  // The selected agent lives in the URL hash, so a view is linkable: /#a2a/claude-ab12
  const [selected, setSelected] = useState(() => decodeURIComponent(location.hash.slice(1)) || null);
  const [detailOpen, setDetailOpen] = useState(false);
  const select = (key: string) => {
    history.replaceState(null, "", `#${key}`);
    setSelected(key);
  };

  const rank = (a: Agent) => (isEnded(a, now) ? 3 : ORDER[a.status]);
  const hasTag = (a: Agent) => !tag || board.tasks.some((t) => t.repo === a.repo && t.agent === a.name && t.tags.includes(tag));
  const agents = board.agents.filter((a) => (!repo || a.repo === repo) && hasTag(a)).toSorted((a, b) => rank(a) - rank(b) || (b.updated > a.updated ? 1 : -1));
  const live = agents.filter((a) => !isEnded(a, now));
  const ended = agents.filter((a) => isEnded(a, now));
  const current = agents.find((a) => agentKey(a) === selected) ?? live[0] ?? ended[0];
  const events = useActivity(current ? agentKey(current) : null);
  const tasksOf = (a: Agent) => board.tasks.filter((t) => t.repo === a.repo && t.agent === a.name);
  const colors = repoColors(board.repos);
  const colorOfRepo = (r: string) => colors.get(r) ?? "var(--ink-2)";
  const colorOf = (a: Agent) => colorOfRepo(a.repo);
  // Lanes: every live agent, plus ended ones that still have a task inside the last hour.
  const lanes = agents.filter((a) => !isEnded(a, now) || tasksOf(a).some((t) => (t.ended ? Date.parse(t.ended) : now) > now - 3_600_000));

  return (
    <div className="flex min-h-dvh flex-col bg-canvas md:h-dvh md:flex-row md:overflow-hidden">
      <Rail live={live} ended={ended} tasks={board.tasks.filter((t) => !repo || t.repo === repo)} repos={board.repos} repo={repo} colorOf={colorOfRepo} tags={tags} tag={tag}
        selected={current ? agentKey(current) : null} now={now} dark={dark} onSelect={select} onRepo={setRepo} onTag={setTag} onTheme={toggleTheme} />
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-4">
        {current ? (
          <Stage agent={current} color={colorOf(current)} tasks={tasksOf(current)} messages={board.messages.filter((m) => m.repo === current.repo)} events={events}
            unread={unreadCount(current, board)} now={now} onDetails={() => setDetailOpen(true)} />
        ) : (
          <section className="rounded-card bg-surface p-8 text-center text-[13px] text-ink-2 shadow-card">
            No agents yet. In a repo run <code className="font-mono">bun cli/mango.ts hook claude</code>, then start a Claude Code session.
          </section>
        )}
        <Timeline agents={lanes} colorOf={colorOf} tasks={board.tasks} messages={board.messages} now={now} selected={current ? agentKey(current) : null} onSelect={select} />
      </main>
      {!connected && <div className="fixed bottom-3 right-3 rounded-full bg-red px-3 py-1 text-[12px] text-white shadow-overlay">board disconnected · reconnecting</div>}
      {detailOpen && current && (
        <AgentDetail key={agentKey(current)} agent={current} tasks={tasksOf(current)} messages={board.messages.filter((m) => m.repo === current.repo)} onClose={() => setDetailOpen(false)} />
      )}
    </div>
  );
}
