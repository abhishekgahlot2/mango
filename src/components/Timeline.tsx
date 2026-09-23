import { useEffect, useRef, useState } from "react";
import { agentKey, isEnded, type Agent, type BoardMessage, type Task } from "@/board";
import { SegmentedControl } from "@/components/atoms/SegmentedControl";

const LABEL_W = 168, TOP = 24, BOTTOM = 26, RIGHT = 28, BAR = 18;

/** Width of an element, tracked with a ResizeObserver, so the SVG draws in real pixels (crisp text, no scaling). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Greedy interval packing: the sub-row index for each bar, so overlapping tasks stack instead of colliding. */
function pack(spans: { s: number; e: number }[]): number[] {
  const rowEnds: number[] = [];
  return spans.map(({ s, e }) => {
    let r = rowEnds.findIndex((end) => end + 6 <= s);
    if (r < 0) r = rowEnds.push(0) - 1;
    rowEnds[r] = e;
    return r;
  });
}

const fit = (title: string, px: number) => {
  const chars = Math.floor((px - 18) / 6.6);
  return chars < 4 ? "" : title.length > chars ? `${title.slice(0, chars - 1)}…` : title;
};

/** Swimlanes per agent over the last hour or today: tasks as tinted pills, notes as ticks, blocked spans, messages as connectors. */
export function Timeline({ agents, colorOf, tasks, messages, now, selected, onSelect }: {
  agents: Agent[]; colorOf: (a: Agent) => string; tasks: Task[]; messages: BoardMessage[]; now: number; selected: string | null; onSelect: (key: string) => void;
}) {
  const [range, setRange] = useState<"1h" | "today">("1h");
  const [box, width] = useWidth<HTMLDivElement>();
  const start = range === "1h" ? now - 3_600_000 : new Date(now).setHours(0, 0, 0, 0);
  const span = Math.max(1, now - start);
  const plotW = Math.max(0, width - LABEL_W - RIGHT);
  const x = (t: string | number) => LABEL_W + Math.max(0, Math.min(1, ((typeof t === "number" ? t : Date.parse(t)) - start) / span)) * plotW;
  // An ended agent's task that was never closed stops where the agent was last seen, not at "now".
  const endOf = (t: Task, a: Agent) => t.ended ?? (isEnded(a, now) ? a.updated : new Date(now).toISOString());
  const lanes = agents.map((a) => {
    const mine = tasks.filter((t) => t.repo === a.repo && t.agent === a.name && Date.parse(t.started) <= now && Date.parse(endOf(t, a)) >= start)
      .toSorted((p, q) => (p.started < q.started ? -1 : 1));
    const rows = pack(mine.map((t) => ({ s: x(t.started), e: x(endOf(t, a)) })));
    const depth = Math.max(1, ...rows.map((r) => r + 1));
    return { a, mine, rows, h: 16 + depth * (BAR + 10) };
  });
  const laneTop = lanes.reduce<number[]>((acc, l, i) => [...acc, (acc[i - 1] ?? TOP) + (lanes[i - 1]?.h ?? 0)], []);
  const height = TOP + lanes.reduce((s, l) => s + l.h, 0) + BOTTOM;
  const laneOf = new Map(agents.map((a, i) => [agentKey(a), i]));
  const cy = (i: number) => laneTop[i] + lanes[i].h / 2;
  const barY = (i: number, row: number) => laneTop[i] + 8 + row * (BAR + 10);
  const tickEvery = range === "1h" ? 600_000 : 3_600_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / tickEvery) * tickEvery; t < now - tickEvery / 4; t += tickEvery) ticks.push(t);
  const fmt = (t: number) => new Date(t).toTimeString().slice(0, 5);

  return (
    <section className="rounded-card bg-surface px-4 pb-1 pt-3 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Timeline · {range === "1h" ? "last hour" : "today"}</span>
        <span className="flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-accent-tint shadow-[inset_3px_0_0_var(--accent)]" />task</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-0.5 bg-ink-2" />note</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-orange-tint shadow-[inset_3px_0_0_var(--orange)]" />blocked</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-2" />message</span>
        </span>
        <SegmentedControl options={["1h", "today"] as const} value={range} onChange={setRange} className="ml-auto h-7" />
      </div>
      <div ref={box} className="mt-1">
        {agents.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-ink-3">Nothing in this window.</div>
        ) : width > 0 && (
          <svg width={width} height={height} className="block" role="img" aria-label="Agent timeline" style={{ fontFamily: "var(--font-sans)" }}>
            <defs>
              <marker id="tl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-2)" /></marker>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} y1={TOP - 4} x2={x(t)} y2={height - BOTTOM + 2} stroke="var(--line)" />
                <text x={x(t)} y={height - 8} fontSize="11" fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--font-mono)">{fmt(t)}</text>
              </g>
            ))}
            {lanes.map(({ a, mine, rows }, i) => {
              const key = agentKey(a);
              const color = colorOf(a);
              const dim = selected !== null && selected !== key;
              return (
                <g key={key} onClick={() => onSelect(key)} style={{ cursor: "pointer" }} opacity={dim ? 0.62 : 1}>
                  {i > 0 && <line x1={LABEL_W - 12} y1={laneTop[i]} x2={width - RIGHT} y2={laneTop[i]} stroke="var(--line)" />}
                  <rect x="0" y={cy(i) - 5} width="3" height="10" rx="1.5" fill={color} />
                  <text x="12" y={cy(i) + 1} fontSize="12" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-mono)">{a.name}</text>
                  <text x="12" y={cy(i) + 14} fontSize="10.5" fill="var(--ink-3)">{a.repo}{isEnded(a, now) ? " · ended" : ""}</text>
                  {mine.map((t, k) => {
                    const s = x(t.started), e = x(endOf(t, a)), w = Math.max(3, e - s), y = barY(i, rows[k]);
                    const open = t.status === "open" && !isEnded(a, now);
                    const blocked = t.log.flatMap((l, j) => (l.text.startsWith("blocked:") ? [[l.t, t.log[j + 1]?.t ?? endOf(t, a)]] : []));
                    return (
                      <g key={t.id}>
                        <title>{t.title} · {t.status}{t.ended ? "" : open ? " · running" : " · left open"}</title>
                        <rect x={s} y={y} width={w} height={BAR} rx="5" fill={open ? color : "var(--ink-3)"} opacity={open ? 0.18 : 0.14} />
                        <rect x={s} y={y} width="3" height={BAR} rx="1.5" fill={open ? color : "var(--ink-3)"} />
                        {blocked.map(([b0, b1], j) => (
                          <rect key={j} x={x(b0)} y={y} width={Math.max(3, x(b1) - x(b0))} height={BAR} rx="5" fill="var(--orange)" opacity="0.35" />
                        ))}
                        <text x={s + 9} y={y + BAR / 2 + 4} fontSize="11" fontWeight="500" fill={open ? "var(--ink)" : "var(--ink-2)"}>{fit(t.title, w)}</text>
                        {t.log.filter((l) => Date.parse(l.t) >= start).map((l, j) => (
                          <rect key={j} x={x(l.t) - 1} y={y + BAR + 2} width="2" height="6" rx="1" fill={color}><title>{l.text}</title></rect>
                        ))}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {messages.filter((m) => Date.parse(m.t) >= start).map((m) => {
              const from = agents.find((a) => a.repo === m.repo && a.name === m.from);
              if (!from) return null;
              const to = m.to === "*" ? null : agents.find((a) => a.repo === m.repo && a.name === m.to);
              const fi = laneOf.get(agentKey(from))!, mx = x(m.t);
              if (!to) {
                return (
                  <g key={m.id}>
                    <title>{m.from} → everyone: {m.text}</title>
                    <circle cx={mx} cy={cy(fi)} r="4" fill="var(--ink-2)" />
                    <circle cx={mx} cy={cy(fi)} r="9" fill="none" stroke="var(--ink-2)" strokeWidth="1" opacity=".6" />
                  </g>
                );
              }
              const ti = laneOf.get(agentKey(to))!;
              const y0 = cy(fi), y1 = cy(ti) + (ti > fi ? -BAR / 2 - 1 : BAR / 2 + 1);
              return (
                <g key={m.id}>
                  <title>{m.from} → {m.to}: {m.text}</title>
                  <line x1={mx} y1={y0} x2={mx} y2={y1} stroke="var(--ink-2)" strokeWidth="1.5" strokeDasharray="3 3" markerEnd="url(#tl-arrow)" />
                  <circle cx={mx} cy={y0} r="3.5" fill="var(--ink-2)" />
                </g>
              );
            })}
            <line x1={x(now)} y1={TOP - 4} x2={x(now)} y2={height - BOTTOM + 2} stroke="var(--accent)" strokeWidth="1.5" />
            <text x={x(now)} y={height - 8} fontSize="11" fill="var(--accent-ink)" textAnchor="end" fontFamily="var(--font-mono)">now</text>
          </svg>
        )}
      </div>
    </section>
  );
}
