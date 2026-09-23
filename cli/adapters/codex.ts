import { homedir } from "node:os";
import { join } from "node:path";
import { installHook, parseClaudeStyleInput } from "./hooks-json";
import type { Adapter } from "./types";

/** Codex's hooks.json uses Claude Code's event names and JSON shape; hooks are global (~/.codex). */
export const codex: Adapter = {
  tool: "codex",
  parseHookInput: parseClaudeStyleInput,
  install(_repoRoot, { command }) {
    const file = join(homedir(), ".codex", "hooks.json");
    installHook(file, "codex", command);
    return `hooked Codex: ${file} (needs hooks = true in ~/.codex/config.toml; Codex may ask you to trust it)`;
  },
  processNames: ["codex"],
};
