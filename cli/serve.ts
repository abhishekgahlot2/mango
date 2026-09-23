import { existsSync, mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { activityEvents } from "./activity";
import { knownRoots, registryPath, snapshotAll } from "./store";

/** Read-only board over this repo's store plus every store in the registry.
 *  Static UI + JSON snapshot + SSE that re-sends the snapshot on any change. */
export function serve(root: string, port: number) {
  const dist = join(import.meta.dir, "..", "dist");
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const activityClients = new Map<ReadableStreamDefaultController<Uint8Array>, string | null>(); // controller → agent key filter
  const enc = new TextEncoder();
  const watched = new Set<string>();

  const roots = () => [...new Set([root, ...knownRoots()])];
  const frame = () => enc.encode(`data: ${JSON.stringify(snapshotAll(roots()))}\n\n`);
  const activityFrames = () => {
    const all = activityEvents(snapshotAll(roots()).agents);
    const byKey = new Map<string | null, Uint8Array>();
    return (key: string | null) => {
      if (!byKey.has(key)) {
        const events = (key ? all.filter((e) => `${e.repo}/${e.agent}` === key) : all).slice(-300);
        byKey.set(key, enc.encode(`data: ${JSON.stringify({ events })}

`));
      }
      return byKey.get(key)!;
    };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const broadcast = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      watchAll();
      const f = frame();
      for (const c of clients) {
        try { c.enqueue(f); } catch { clients.delete(c); }
      }
    }, 150);
  };
  const watchAll = () => {
    for (const r of roots()) {
      if (watched.has(r) || !existsSync(r)) continue;
      watched.add(r);
      watch(r, { recursive: true }, broadcast);
    }
  };

  mkdirSync(root, { recursive: true });
  mkdirSync(dirname(registryPath()), { recursive: true });
  watch(dirname(registryPath()), broadcast); // a new repo registering itself
  watchAll();

  // Bun drops idle connections after 10s by default; SSE streams are idle by nature.
  setInterval(() => {
    for (const c of clients) {
      try { c.enqueue(enc.encode(": ping\n\n")); } catch { clients.delete(c); }
    }
  }, 20_000);

  // One transcript scan per tick; each subscriber gets only its agent's events, and only when they changed.
  const lastSent = new Map<ReadableStreamDefaultController<Uint8Array>, Uint8Array>();
  setInterval(() => {
    if (!activityClients.size) return;
    const frameFor = activityFrames();
    for (const [c, key] of activityClients) {
      const frame = frameFor(key);
      if (lastSent.get(c) === frame) continue;
      lastSent.set(c, frame);
      try { c.enqueue(frame); } catch { activityClients.delete(c); lastSent.delete(c); }
    }
  }, 500);

  Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 255,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api/state") return Response.json(snapshotAll(roots()));
      if (pathname === "/api/events") {
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { ctrl = c; clients.add(c); c.enqueue(frame()); },
          cancel() { clients.delete(ctrl); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      if (pathname === "/api/activity") {
        const key = new URL(req.url).searchParams.get("agent"); // "repo/name", or everything
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) { ctrl = c; activityClients.set(c, key); c.enqueue(activityFrames()(key)); },
          cancel() { activityClients.delete(ctrl); lastSent.delete(ctrl); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
      }
      const file = Bun.file(join(dist, pathname === "/" ? "index.html" : pathname));
      return new Response((await file.exists()) ? file : Bun.file(join(dist, "index.html")));
    },
  });
  console.log(`mango board: http://localhost:${port}  (${roots().length} store(s); registry ${registryPath()})`);
}
