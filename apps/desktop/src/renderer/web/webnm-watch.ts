// THE BROWSER'S LIVE QUERIES — one mechanism under every lane's watch.
//
// Each lane file used to carry its own copy of `watch()`: run the query, then run it again on any
// change to its tables, and hand the renderer whatever came back. Three things that shape did not
// do, measured on the Acme replica (1.7k messages, 18 rooms):
//
//  · it never waited. Every change started another run while the last one was still in the one
//    connection's queue, so a burst of synced writes stacked copies of the heaviest queries.
//  · it delivered ticks, not results. A re-run that returned the same rows still handed over a
//    fresh array, and a fresh array re-renders everything under the watcher.
//  · it never shared. The same workspace-wide query ran once per subscriber: App's task watch and
//    every unit card in an open thread each paid for the whole task list.
//
// The replica rows are flat records of strings, numbers and nulls, so a shallow compare is exact.
import type { PowerSyncDatabase } from '@powersync/web';

/** the same rows, in the same order, with the same values */
export function sameRows(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
    const kx = Object.keys(x);
    if (kx.length !== Object.keys(y).length) return false;
    for (const k of kx) if ((x as Record<string, unknown>)[k] !== (y as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/**
 * A live query: run it now, then again whenever one of `tables` changes. One run is in flight at
 * a time (a change that lands mid-run makes exactly one more run), and a result equal to the last
 * one delivered is not delivered again. A failed read leaves the last good value standing.
 */
export function watchQuery<V>(
  db: PowerSyncDatabase,
  tables: string[],
  run: () => Promise<V>,
  cb: (value: V) => void,
  same: (a: V, b: V) => boolean,
  onError?: (e: unknown) => void,
  merge?: (prev: V, next: V) => V,
): () => void {
  let live = true;
  let running = false;
  let dirty = false;
  let delivered = false;
  let last: V | undefined;
  const pump = (): void => {
    if (!live) return;
    if (running) { dirty = true; return; }
    running = true;
    dirty = false;
    void run()
      .then((v) => {
        if (!live || (delivered && same(last as V, v))) return;
        const out = delivered && merge ? merge(last as V, v) : v;
        delivered = true;
        last = out;
        cb(out);
      })
      .catch((e: unknown) => { if (live) onError?.(e); })
      .finally(() => {
        running = false;
        if (dirty) pump();
      });
  };
  pump();
  const stop = db.onChangeWithCallback({ onChange: () => pump() }, { tables });
  return () => { live = false; stop(); };
}

/**
 * The next rows, with every row that did not change handed back as the SAME object as last time
 * (matched by `id`, else by position). A thread that gains one message then re-renders one row,
 * not all of them, wherever its row component is memoized.
 */
export function keepRows<T>(prev: readonly T[], next: T[]): T[] {
  const byId = new Map<unknown, T>();
  for (const r of prev) {
    const id = (r as { id?: unknown } | null)?.id;
    if (id != null) byId.set(id, r);
  }
  return next.map((r, i) => {
    const id = (r as { id?: unknown } | null)?.id;
    const old = id != null ? byId.get(id) : prev[i];
    return old !== undefined && sameRows([old], [r]) ? old : r;
  });
}

/** watchQuery for a row list — every lane's shape but the roster's */
export function watchRows<T>(db: PowerSyncDatabase, tables: string[], run: () => Promise<T[]>, cb: (rows: T[]) => void, onError?: (e: unknown) => void): () => void {
  return watchQuery<T[]>(db, tables, run, cb, sameRows, onError, keepRows);
}

/**
 * The same object back, per argument list, while the answer does not change. The renderer POLLS
 * some reads (bootstrap every 1.5 s, the project list every 2.5 s, a task's drafts every 4 s) and
 * stores each answer in React state; a new object with the same content re-renders everything
 * under that state — the whole shell, or an open thread — and an unchanged one does not.
 */
export function keepIdentity<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const last = new Map<string, { json: string; value: R }>();
  return async (...args: A) => {
    const r = await fn(...args);
    let json: string;
    let key: string;
    try { json = JSON.stringify(r); key = JSON.stringify(args); } catch { return r; }
    const prev = last.get(key);
    if (prev && prev.json === json) return prev.value;
    if (!prev && last.size >= 64) last.delete(last.keys().next().value as string);
    last.set(key, { json, value: r });
    return r;
  };
}

/** keepIdentity over the named reads of a lane set — the ones some surface polls */
export function stableReads<L extends object>(lanes: L, names: readonly string[]): L {
  const out: Record<string, unknown> = { ...(lanes as Record<string, unknown>) };
  for (const k of names) {
    const fn = out[k];
    if (typeof fn === 'function') out[k] = keepIdentity(fn as (...a: unknown[]) => Promise<unknown>);
  }
  return out as L;
}

type WatchFn = (...args: unknown[]) => () => void;

/** shareWatch over every `watch*` lane of a REPLICA lane set. Only replica lanes: a stream (a
 *  terminal, an agent's live log) owes each subscriber its own feed, so it must not pass here. */
export function shareWatches<L extends object>(lanes: L): L {
  const out: Record<string, unknown> = { ...(lanes as Record<string, unknown>) };
  for (const [k, v] of Object.entries(out)) if (k.startsWith('watch') && typeof v === 'function') out[k] = shareWatch(v as WatchFn);
  return out as L;
}

/**
 * One live query per (method, arguments), however many components subscribe. The first
 * subscriber starts it, a later one is handed the current value at once, and the last one to
 * leave stops it. The callback is always the last argument; the rest name the query.
 */
export function shareWatch(watch: WatchFn): WatchFn {
  type Entry = { subs: Set<(v: unknown) => void>; stop: () => void; has: boolean; value: unknown };
  const shared = new Map<string, Entry>();
  return (...args: unknown[]) => {
    const cb = args[args.length - 1] as (v: unknown) => void;
    const sub = (v: unknown): void => cb(v);
    const key = JSON.stringify(args.slice(0, -1));
    let e = shared.get(key);
    if (e) {
      e.subs.add(sub);
      // a late subscriber gets the live value on the next tick, the way a fresh query would arrive
      const entry = e;
      if (entry.has) queueMicrotask(() => { if (entry.subs.has(sub)) sub(entry.value); });
    } else {
      const entry: Entry = { subs: new Set([sub]), stop: () => {}, has: false, value: undefined };
      shared.set(key, entry);
      entry.stop = watch(...args.slice(0, -1), (v: unknown) => {
        entry.has = true;
        entry.value = v;
        for (const s of [...entry.subs]) s(v);
      });
      e = entry;
    }
    const entry = e;
    return () => {
      if (!entry.subs.delete(sub) || entry.subs.size) return;
      shared.delete(key);
      entry.stop();
    };
  };
}
