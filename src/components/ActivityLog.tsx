import { useEffect, useRef, useState } from "react";
import { glyphFor } from "@/board";
import { AgentGlyph } from "./AgentGlyph";

type ActivityEvent = { id: string; t: string; repo: string; agent: string; kind: string; text: string };
const ROW_HEIGHT = 40;
const OVERSCAN = 5;

export function activityRange(count: number, scrollTop: number, viewportHeight: number) {
  const start = Math.min(count, Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  return { start, end };
}

/** Live transcript activity across the agents shown on the board. */
export function ActivityLog() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stream = new EventSource("/api/activity");
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (event) => setEvents((JSON.parse(event.data) as { events: ActivityEvent[] }).events);
    return () => stream.close();
  }, []);

  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = events.toReversed().filter((event) =>
    !needle || [event.repo, event.agent, event.kind, event.text].some((value) => value.toLowerCase().includes(needle)));
  const { start, end } = activityRange(visible.length, scrollTop, viewportHeight);

  return (
    <section className="rounded-card bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pl-3.5 pr-2">
        <h2 className="text-[14px] font-semibold">Live activity</h2>
        <span className="text-[13px] text-ink-2">{events.length}</span>
        <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <span className={`size-1.5 rounded-full ${connected ? "bg-green" : "bg-red"}`} />
          {connected ? "streaming" : "disconnected"}
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            viewport.current?.scrollTo({ top: 0 });
            setScrollTop(0);
          }}
          placeholder="Filter activity…"
          aria-label="Filter activity"
          className="ml-auto h-8 w-full rounded-control bg-field px-3 text-[13px] shadow-inset-field placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-accent sm:w-72"
        />
      </header>
      <div ref={viewport} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className="max-h-[65dvh] min-h-72 overflow-auto border-t border-line">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-left text-[13px]">
          <thead className="sticky top-0 bg-surface text-[12px] text-ink-3">
            <tr className="border-b border-line">
              <th scope="col" className="w-28 px-3.5 py-1.5 font-normal">Time</th>
              <th scope="col" className="w-44 px-3.5 py-1.5 font-normal">Agent</th>
              <th scope="col" className="w-28 px-3.5 py-1.5 font-normal">Event</th>
              <th scope="col" className="w-full px-3.5 py-1.5 font-normal">Detail</th>
            </tr>
          </thead>
          <tbody>
            {start > 0 && <tr aria-hidden="true"><td colSpan={4} className="p-0" style={{ height: start * ROW_HEIGHT }} /></tr>}
            {visible.slice(start, end).map((event) => (
              <tr key={event.id} className="h-10 border-b border-line last:border-0">
                <td className="overflow-hidden whitespace-nowrap px-3.5 font-mono text-[12px] tabular-nums text-ink-2">{new Date(event.t).toLocaleTimeString()}</td>
                <td className="overflow-hidden whitespace-nowrap px-3.5 font-medium">
                  <span className="flex min-w-0 items-center gap-2"><AgentGlyph glyph={glyphFor(event.agent)} className="size-4 shrink-0" /><span className="truncate">{event.repo}/{event.agent}</span></span>
                </td>
                <td className="overflow-hidden whitespace-nowrap px-3.5 text-ink-2">{event.kind}</td>
                <td className="overflow-hidden px-3.5" title={event.text}><span className="block truncate">{event.text}</span></td>
              </tr>
            ))}
            {end < visible.length && <tr aria-hidden="true"><td colSpan={4} className="p-0" style={{ height: (visible.length - end) * ROW_HEIGHT }} /></tr>}
            {visible.length === 0 && (
              <tr><td colSpan={4} className="px-3.5 py-8 text-center text-ink-3">
                {events.length ? `No activity matches “${query}”.` : "Waiting for agent activity…"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
