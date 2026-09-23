import { useState } from "react";
import { glyphFor, hhmm, type BoardMessage } from "@/board";
import { AgentGlyph } from "./AgentGlyph";

function Party({ name }: { name: string }) {
  if (name === "*") return <span className="text-ink-2">everyone</span>;
  return (
    <>
      <AgentGlyph glyph={glyphFor(name)} className="size-4 shrink-0" />
      {name}
    </>
  );
}

const COLUMNS = ["Time", "From", "To", "Message"];

/** Newest first, one line per message, with a text filter. */
export function MessageLog({ messages }: { messages: BoardMessage[] }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = messages
    .toReversed()
    .filter((m) => !needle || [m.from, m.to, m.text].some((f) => f.toLowerCase().includes(needle)));

  return (
    <section className="rounded-card bg-surface shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pl-3.5 pr-2">
        <h2 className="text-[14px] font-semibold">Messages</h2>
        <span className="text-[13px] text-ink-2">{messages.length}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter messages…"
          aria-label="Filter messages"
          className="ml-auto h-8 w-full rounded-control bg-field px-3 text-[13px] shadow-inset-field
            placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-accent sm:w-72"
        />
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-y border-line text-[12px] text-ink-3">
              {COLUMNS.map((label) => (
                <th key={label} scope="col" className="px-3.5 py-1.5 font-normal">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.id} className="h-10 border-b border-line last:border-0">
                <td className="px-3.5 font-mono text-[12px] tabular-nums text-ink-2">{hhmm(m.t)}</td>
                <td className="whitespace-nowrap px-3.5 font-medium">
                  <span className="flex items-center gap-2"><Party name={m.from} /></span>
                </td>
                <td className="whitespace-nowrap px-3.5">
                  <span className="flex items-center gap-2"><span className="text-ink-3">→</span><Party name={m.to} /></span>
                </td>
                <td className="w-full min-w-64 break-words px-3.5 py-2">{m.text}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3.5 py-6 text-center text-ink-3">
                  {messages.length ? `No messages match “${query}”.` : "No messages yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
