import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentNameFor } from "../store";
import type { Adapter } from "./types";

const MARK = "<!-- mango -->";

/** OpenCode has no hook file mango can write yet, but it reads AGENTS.md every session, so the
 *  instructions go there. Identity comes from the directory until a hook exists. */
export const opencode: Adapter = {
  tool: "opencode",
  parseHookInput: (_raw, fallbackCwd) => ({ session: null, cwd: fallbackCwd, full: true }),
  install(repoRoot, { command }) {
    const file = join(repoRoot, "AGENTS.md");
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (existing.includes(MARK)) return `OpenCode: ${file} already has the mango section`;
    const name = agentNameFor("opencode", null, repoRoot);
    const block = `\n${MARK}\n## mango\nReport what you work on. At session start run \`${command}\` to read messages, then:\n\`${command.replace(/ inbox --hook \w+$/, "")} --as ${name} start "task title" | note "what you did" | done "summary" | status blocked "why" | send <agent|*> "text"\`\n`;
    writeFileSync(file, existing + block);
    return `OpenCode: added a mango section to ${file} (read every session)`;
  },
  processNames: ["opencode"],
};
