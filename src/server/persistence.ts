import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";

/**
 * Durable persistence bridge.
 *
 * The API services keep their working data in JSON files (and in-memory copies of them).
 * On hosts with an ephemeral filesystem (Netlify Server, Vercel) those files are lost on
 * every cold start, so a persistence backend can be registered to mirror every JSON store
 * write and every uploaded file to durable storage. When no backend is registered (local
 * `npm run dev` / `npm start`), the JSON files on disk remain the only storage.
 */
export interface PersistenceBackend {
  saveDocument(name: string, json: string): Promise<void>;
  saveFile(key: string, data: Buffer): Promise<void>;
  deleteFile(key: string): Promise<void>;
  loadFile(key: string): Promise<Buffer | null>;
}

let backend: PersistenceBackend | null = null;

export function setPersistenceBackend(next: PersistenceBackend | null) {
  backend = next;
}

export function hasPersistenceBackend(): boolean {
  return backend !== null;
}

/** Pending durable writes started while handling the current request. */
const requestPending = new AsyncLocalStorage<Set<Promise<void>>>();
/** Pending durable writes started outside of a request (e.g. module initialisation). */
const backgroundPending = new Set<Promise<void>>();
/** Per-key write chains so successive snapshots of the same store are written in order. */
const keyChains = new Map<string, Promise<void>>();

function enqueue(key: string, task: () => Promise<void>) {
  const previous = keyChains.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  keyChains.set(key, current);

  const settled = current.then(
    () => undefined,
    (err) => {
      console.error(`Durable persistence failed for ${key}:`, err);
      throw err;
    }
  );
  // Prevent unhandled rejections; failures are surfaced to callers via the pending sets.
  settled.catch(() => undefined);
  current
    .catch(() => undefined)
    .finally(() => {
      if (keyChains.get(key) === current) keyChains.delete(key);
    });

  const pending = requestPending.getStore();
  if (pending) {
    pending.add(settled);
  } else {
    backgroundPending.add(settled);
    settled.catch(() => undefined).finally(() => backgroundPending.delete(settled));
  }
}

export function persistDocument(name: string, json: string) {
  const active = backend;
  if (!active) return;
  enqueue(`doc:${name}`, () => active.saveDocument(name, json));
}

export function persistFile(key: string, data: Buffer) {
  const active = backend;
  if (!active) return;
  const copy = Buffer.from(data);
  enqueue(`file:${key}`, () => active.saveFile(key, copy));
}

export function removePersistedFile(key: string) {
  const active = backend;
  if (!active) return;
  enqueue(`file:${key}`, () => active.deleteFile(key));
}

export async function loadPersistedFile(key: string): Promise<Buffer | null> {
  if (!backend) return null;
  // Make sure an in-flight write for the same key lands first.
  await keyChains.get(`file:${key}`)?.catch(() => undefined);
  return backend.loadFile(key);
}

/** Waits for writes started outside of request handling (used during server start-up). */
export async function flushBackgroundWrites(): Promise<void> {
  while (backgroundPending.size > 0) {
    await Promise.all([...backgroundPending]);
  }
}

/**
 * Express middleware: tracks durable writes made while handling a request and holds the
 * response back until they are committed. If a write fails before headers are sent, the
 * client receives a 500 instead of a false success. Must be mounted after body parsers.
 */
export function durableWritesMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (!backend) return next();

  const pending = new Set<Promise<void>>();
  const originalEnd = res.end.bind(res) as (...args: any[]) => Response;
  let intercepted = false;

  (res as any).end = (...args: any[]) => {
    if (intercepted || pending.size === 0) {
      return originalEnd(...args);
    }
    intercepted = true;
    const waitForAll = async () => {
      // Writes can enqueue further writes; loop until the set is drained.
      let failed = false;
      const seen = new Set<Promise<void>>();
      while ([...pending].some((p) => !seen.has(p))) {
        const batch = [...pending].filter((p) => !seen.has(p));
        batch.forEach((p) => seen.add(p));
        const results = await Promise.allSettled(batch);
        if (results.some((r) => r.status === "rejected")) failed = true;
      }
      return failed;
    };
    waitForAll().then((failed) => {
      if (failed && !res.headersSent) {
        res.statusCode = 500;
        res.removeHeader("Content-Length");
        res.removeHeader("ETag");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        originalEnd(
          JSON.stringify({
            success: false,
            error: "The change could not be saved to the database. Please try again."
          })
        );
        return;
      }
      originalEnd(...args);
    });
    return res;
  };

  requestPending.run(pending, () => next());
}
