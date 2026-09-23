import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS, adapterFor, toolOf } from "./index";
import { installHook } from "./hooks-json";
import { opencode } from "./opencode";

test("registry: three first-class tools, anything else is 'other'", () => {
  expect(ADAPTERS.map((a) => a.tool)).toEqual(["claude", "codex", "opencode"]);
  expect(toolOf("codex-9f3e")).toBe("codex");
  expect(toolOf("gemini-1")).toBe("other");
  expect(() => adapterFor("gemini")).toThrow(/no adapter/);
});

test("claude/codex parse the harness stdin; non-JSON or SessionStart means full output", () => {
  const p = adapterFor("claude").parseHookInput;
  expect(p('{"session_id":"ab12cd","cwd":"/x","hook_event_name":"UserPromptSubmit"}', "/fallback")).toEqual({ session: "ab12cd", cwd: "/x", full: false });
  expect(p('{"session_id":"ab12cd","cwd":"/x","hook_event_name":"SessionStart"}', "/fallback")).toEqual({ session: "ab12cd", cwd: "/x", full: true });
  expect(p("garbage", "/fallback")).toEqual({ session: null, cwd: "/fallback", full: true });
  expect(adapterFor("codex").parseHookInput).toBe(p);
});

test("hooks-json install merges both events once and keeps existing hooks", () => {
  const f = join(mkdtempSync(join(tmpdir(), "mango-hook-")), "settings.json");
  writeFileSync(f, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }] } }));
  installHook(f, "claude", "bun mango.ts inbox --hook claude");
  installHook(f, "claude", "bun mango.ts inbox --hook claude");
  const cfg = JSON.parse(readFileSync(f, "utf8"));
  expect(cfg.hooks.Stop).toHaveLength(1);
  expect(cfg.hooks.SessionStart).toHaveLength(1);
  expect(cfg.hooks.SessionStart[0].matcher).toBe("startup|resume|compact");
  expect(cfg.hooks.UserPromptSubmit[0].hooks[0].command).toMatch(/inbox --hook claude$/);
});

test("opencode install appends one mango section to AGENTS.md", () => {
  const repo = mkdtempSync(join(tmpdir(), "mango-oc-"));
  writeFileSync(join(repo, "AGENTS.md"), "# Rules\n");
  const first = opencode.install(repo, { global: false, command: "bun mango.ts inbox --hook opencode" });
  const again = opencode.install(repo, { global: false, command: "bun mango.ts inbox --hook opencode" });
  const md = readFileSync(join(repo, "AGENTS.md"), "utf8");
  expect(first).toMatch(/added/);
  expect(again).toMatch(/already/);
  expect(md.startsWith("# Rules\n")).toBe(true);
  expect(md.match(/## mango/g)).toHaveLength(1);
  expect(md).toContain("--as opencode-");
});
