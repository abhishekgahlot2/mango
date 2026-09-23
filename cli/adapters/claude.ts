import { homedir } from "node:os";
import { join } from "node:path";
import { installHook, parseClaudeStyleInput } from "./hooks-json";
import type { Adapter } from "./types";

export const claude: Adapter = {
  tool: "claude",
  parseHookInput: parseClaudeStyleInput,
  install(repoRoot, { global, command }) {
    const file = global ? join(homedir(), ".claude", "settings.json") : join(repoRoot, ".claude", "settings.json");
    installHook(file, "claude", command);
    return `hooked Claude Code: ${file}${global ? " (all repos; --project for this repo only)" : ""}`;
  },
  processNames: ["claude"],
};
