import { Timestamp } from 'firebase-admin/firestore';

// A small in-memory Firestore for the gateway tests: `collection(name).doc(id)`
// with `get`, `set` and `update`. Every write is logged before it is applied,
// with Timestamp values as '<ts:MILLIS>', so a test can pin the exact writes
// a handler makes, including an update that fails on a missing document.

export interface WriteLogEntry {
  method: 'set' | 'update';
  path: string;
  data: unknown;
  merge: boolean;
}

type Doc = Record<string, unknown>;

function isPlainObject(value: unknown): value is Doc {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function normalise(value: unknown): unknown {
  if (value instanceof Timestamp) return `<ts:${value.toMillis()}>`;
  if (Array.isArray(value)) return value.map(normalise);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}

// A merge-set merges nested maps field by field, as Firestore does.
function merge(current: Doc, data: Doc): Doc {
  const out: Doc = { ...current };
  for (const [key, value] of Object.entries(data)) {
    const existing = out[key];
    out[key] =
      isPlainObject(value) && isPlainObject(existing) ? merge(existing, value) : value;
  }
  return out;
}

// An update replaces the field each key names; a dotted key names a nested field.
function applyUpdate(current: Doc, data: Doc): Doc {
  const out: Doc = { ...current };
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.');
    let target = out;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      target[part] = isPlainObject(next) ? { ...next } : {};
      target = target[part] as Doc;
    }
    target[parts[parts.length - 1] as string] = value;
  }
  return out;
}

class NotFoundError extends Error {
  readonly code = 5;
  constructor(path: string) {
    super(`5 NOT_FOUND: No document to update: ${path}`);
  }
}

export function makeFakeFirestore(seed: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(Object.entries(seed));
  const writes: WriteLogEntry[] = [];

  const docRef = (path: string) => ({
    path,
    async get() {
      const data = docs.get(path);
      return { exists: data !== undefined, data: () => data };
    },
    async set(data: Doc, opts?: { merge?: boolean }) {
      const isMerge = opts?.merge === true;
      writes.push({ method: 'set', path, data: normalise(data), merge: isMerge });
      docs.set(path, isMerge ? merge(docs.get(path) ?? {}, data) : data);
    },
    async update(data: Doc) {
      writes.push({ method: 'update', path, data: normalise(data), merge: false });
      const current = docs.get(path);
      if (current === undefined) throw new NotFoundError(path);
      docs.set(path, applyUpdate(current, data));
    }
  });

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`)
    })
  };

  return { db, docs, writes };
}
