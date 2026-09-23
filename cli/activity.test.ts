import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityEvents, parseActivityLine, parseCodexActivityLine } from "./activity";
import type { BoardAgent } from "./store";

const agent: BoardAgent = {
  name: "claude-c6d2", tool: "claude", status: "working", task: null, updated: "2026-09-23T18:00:00.000Z",
  inbox_cursor: "", cwd: "/tmp/a2a", branch: null, session: null, pid: null, alive: null, repo: "a2a",
};

test("parses useful Claude blocks and truncates large content", () => {
  const line = JSON.stringify({ uuid: "u1", timestamp: "2026-09-23T18:01:00.000Z", type: "assistant", message: { content: [
    { type: "thinking", thinking: "hidden" },
    { type: "text", text: "working" },
    { type: "tool_use", name: "Bash", input: { command: "x".repeat(1000) } },
  ] } });
  expect(parseActivityLine(line, agent).map(({ kind }) => kind)).toEqual(["assistant", "tool_use"]);
  expect(parseActivityLine(line, agent)[0]).toMatchObject({ repo: "a2a", id: "a2a/claude-c6d2/u1/1" });
  expect(parseActivityLine(line, agent)[1].text.length).toBe(800);
});

test("finds a legacy Claude session by agent-name prefix", () => {
  const root = mkdtempSync(join(tmpdir(), "mango-activity-"));
  const dir = join(root, "-tmp-a2a");
  mkdirSync(dir);
  writeFileSync(join(dir, "c6d2245b-rest.jsonl"), JSON.stringify({
    uuid: "u2", timestamp: "2026-09-23T18:02:00.000Z", type: "user", message: { content: "ship it" },
  }) + "\n");
  expect(activityEvents([agent], root)).toMatchObject([{ agent: "claude-c6d2", kind: "user", text: "ship it" }]);
});

test("reads a registered Codex session transcript", () => {
  const root = mkdtempSync(join(tmpdir(), "mango-codex-"));
  const dir = join(root, "2026", "09", "23");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rollout-2026-09-23T18-00-00-session-123.jsonl"), JSON.stringify({
    timestamp: "2026-09-23T18:01:00.000Z", type: "response_item",
    payload: { type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "working" }] },
  }) + "\n");
  const codex = { ...agent, name: "codex-1234", tool: "codex", session: "session-123" };
  expect(activityEvents([codex], root, root)).toMatchObject([{ agent: "codex-1234", kind: "assistant", text: "working" }]);
  expect(parseCodexActivityLine("{}", codex)).toEqual([]);
});
