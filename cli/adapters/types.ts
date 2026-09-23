/** Everything mango knows about one coding-agent harness lives in its adapter.
 *  Adding a harness = adding one file here and registering it in ./index.ts. */
export type HookInput = {
  /** Harness session id, when the hook provides one. Names are `<tool>-<first 4 chars>`. */
  session: string | null;
  cwd: string;
  /** True on session start (print identity + commands); false on a prompt turn (unread only). */
  full: boolean;
};

export type Adapter = {
  /** Name prefix and glyph key: agents are `<tool>-<id>`. */
  tool: string;
  /** Turn the harness's hook stdin into identity; `fallbackCwd` when the harness sends none. */
  parseHookInput(raw: string, fallbackCwd: string): HookInput;
  /** Wire the harness so `command` runs at session start and on each prompt. Returns what was done. */
  install(repoRoot: string, opts: { global: boolean; command: string }): string;
  /** Process names that identify the harness when walking up from a hook. */
  processNames: string[];
};
