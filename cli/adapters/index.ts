import { claude } from "./claude";
import { codex } from "./codex";
import { opencode } from "./opencode";
import type { Adapter } from "./types";

export type { Adapter, HookInput } from "./types";

/** First-class harnesses. Anything else works through the CLI with `--as other-<name>`. */
export const ADAPTERS: Adapter[] = [claude, codex, opencode];

export function adapterFor(tool: string): Adapter {
  const a = ADAPTERS.find((x) => x.tool === tool);
  if (!a) throw new Error(`no adapter for "${tool}" (have: ${ADAPTERS.map((x) => x.tool).join(", ")})`);
  return a;
}

/** Tool from an agent name: `claude-ab12` → claude. */
export const toolOf = (name: string) => ADAPTERS.find((a) => name.startsWith(`${a.tool}-`))?.tool ?? "other";
