# mango — design (2026-09-23)

A per-repo, local-first board where coding agents (Claude Code, Codex, later OpenCode)
self-report what they are doing and message each other; the person orchestrating watches.

**Locked decisions:** local-first · per-repo `.mango/` · pull via hooks · agents self-report
(no backlog/assignment) · files + CLI + read-only board · "mango" theme (talkto layout on
Beautiful UI tokens).

## 1. Store — `.mango/` in the repo

One JSON file per thing, written temp-then-rename (atomic) so parallel agents never clobber.

```
agents/<name>.json      { name, tool, status: working|blocked|idle, task, updated, inbox_cursor }
tasks/<id>.json         { id, agent, title, status: open|done, log: [{t, text}], started, ended }
messages/<ts>-<n>.json  { t, from, to: "<agent>" | "*", text }
```

Unread for an agent = messages whose filename sorts after its `inbox_cursor`. Message files are
never rewritten. Store root: `MANGO_DIR`, else nearest ancestor with `.mango/`, else nearest
ancestor with `.git/`, else cwd. Created on first write.

## 2. CLI — `mango`

`start "title"|t-id` (new task becomes current; other open tasks stay queued) · `note "text"` · `done ["text"]` · `status working|blocked|idle ["why"]` ·
`send <agent|*> "text"` · `inbox [--peek]` · `agents` · `hook claude|codex` · `serve [--port]`.

Identity: `--as <name>` or `MANGO_AGENT`. Tool is inferred from the name prefix
(`claude-…`, `codex-…`, `opencode-…`), else `other`.

## 3. Hooks

`mango inbox --hook <tool>` reads the hook's stdin JSON (`session_id`, `cwd`), names the agent
`<tool>-<first 4 of session_id>`, and prints (as context the agent sees):
identity + the exact commands, current task, unread messages; advances the cursor.

- Claude Code: `SessionStart` (matcher `startup|resume|compact`, full output) and
  `UserPromptSubmit` (unread only). Plain stdout on exit 0 becomes context (documented).
- Codex: same two events in `~/.codex/hooks.json` (same JSON shape as Claude's).
- `mango hook claude` merges into `.claude/settings.json` in the repo; `mango hook codex`
  merges into `~/.codex/hooks.json`. Idempotent.

## 4. Board — `mango serve` (:4321)

Bun serves the built UI, `GET /api/state` (snapshot), `GET /api/events` (SSE; snapshot on
connect and whenever `.mango/` changes, debounced). Read-only. Last 500 messages.

## 5. UI

Header: repo name, agent count. Agent cards: tool glyph, name, status pill, current task +
elapsed, last log lines, unread count; card flashes on update. Below: messages feed (table:
time, from → to, text) and done tasks with logs. Filter box. Reuses `AgentGlyph`, `Button`,
`Chip`, `foundation.css`; the fake feed is removed.

## 6. Tests

bun tests: store write/read/atomicity, CLI verbs against a temp store, inbox cursor, hook
output. Manual: two `claude` sessions with the hook installed, watch the board.

## Out of v1

Push delivery, OpenCode plugin, writing from the board, channels, auth, hosting.
