import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

// In-memory stand-in for the slice of Firestore the save trigger uses:
//   articles/{id}                        get, update, where('normalizedUrl', '==', v).limit(n)
//   users/{uid}/articles/{id}            get, update
//   users/{uid}/articleMarkers/{id}      set
//   runTransaction(fn)                   tx.get(ref | query), tx.create, tx.update, tx.set
// Transaction writes are applied after fn resolves, like a commit: tx.create of
// an existing doc then fails the whole commit with ALREADY_EXISTS (code 6). update() of a missing doc
// throws NOT_FOUND (code 5). Every write is logged in order, normalised.

type Doc = Record<string, unknown>;

export interface RecordedWrite {
  method: 'create' | 'set' | 'update';
  inTransaction: boolean;
  path: string;
  data: unknown;
  merge: boolean;
}

/** Timestamps become '<timestamp>', an increment '<increment:N>', any other sentinel '<fieldvalue>'. */
export function normalise(value: unknown): unknown {
  if (value instanceof Timestamp) return '<timestamp>';
  if (value instanceof FieldValue) {
    for (const n of [1, -1]) {
      if (value.isEqual(FieldValue.increment(n))) return `<increment:${n}>`;
    }
    return '<fieldvalue>';
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}

function codeError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Applies an update's (possibly dotted) fields to a copy of doc; an increment adds to the stored number. */
function applyUpdate(doc: Doc, data: Doc): Doc {
  const out: Doc = structuredClone(doc);
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.');
    let target: Doc = out;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      target[part] = next && typeof next === 'object' ? next : {};
      target = target[part] as Doc;
    }
    const leaf = parts[parts.length - 1]!;
    if (value instanceof FieldValue && value.isEqual(FieldValue.increment(1))) {
      const current = target[leaf];
      target[leaf] = (typeof current === 'number' ? current : 0) + 1;
    } else {
      target[leaf] = value;
    }
  }
  return out;
}

interface Ref {
  kind: 'ref';
  id: string;
  path: string;
  get(): Promise<Snap>;
  update(data: Doc): Promise<void>;
  set(data: Doc, opts?: { merge?: boolean }): Promise<void>;
}

interface Snap {
  id: string;
  exists: boolean;
  data(): Doc | undefined;
  get(field: string): unknown;
}

interface Query {
  kind: 'query';
  limit(n: number): Query;
  run(): { docs: Snap[] };
}

export function makeRecordingDb(seed: { articles?: Record<string, Doc>; users?: Record<string, Doc> } = {}) {
  // One flat store keyed by full document path.
  const docs = new Map<string, Doc>();
  for (const [id, data] of Object.entries(seed.articles ?? {})) docs.set(`articles/${id}`, data);
  for (const [path, data] of Object.entries(seed.users ?? {})) docs.set(`users/${path}`, data);
  const writes: RecordedWrite[] = [];

  const snap = (path: string): Snap => {
    const data = docs.get(path);
    const id = path.split('/').pop()!;
    return { id, exists: data !== undefined, data: () => data, get: (field) => data?.[field] };
  };

  const write = (method: RecordedWrite['method'], inTransaction: boolean, path: string, data: Doc, merge = false) => {
    writes.push({ method, inTransaction, path, data: normalise(data), merge });
    const existing = docs.get(path);
    if (method === 'create') {
      if (existing !== undefined) throw codeError(6, `ALREADY_EXISTS: ${path}`);
      docs.set(path, data);
    } else if (method === 'update') {
      if (existing === undefined) throw codeError(5, `NOT_FOUND: ${path}`);
      docs.set(path, applyUpdate(existing, data));
    } else {
      docs.set(path, merge ? applyUpdate(existing ?? {}, data) : data);
    }
  };

  const ref = (path: string): Ref => ({
    kind: 'ref',
    id: path.split('/').pop()!,
    path,
    get: async () => snap(path),
    update: async (data) => write('update', false, path, data),
    set: async (data, opts) => write('set', false, path, data, opts?.merge === true),
  });

  const query = (field: string, value: unknown, max = Infinity): Query => ({
    kind: 'query',
    limit: (n) => query(field, value, n),
    run: () => ({
      docs: [...docs.entries()]
        .filter(([path, data]) => /^articles\/[^/]+$/.test(path) && data[field] === value)
        .slice(0, max)
        .map(([path]) => snap(path)),
    }),
  });

  const collection = (base: string) => ({
    doc: (id: string) => ({
      ...ref(`${base}/${id}`),
      collection: (sub: string) => collection(`${base}/${id}/${sub}`),
    }),
    where(field: string, op: string, value: unknown) {
      if (base !== 'articles' || op !== '==') throw new Error(`unexpected query on ${base}`);
      return query(field, value);
    },
  });

  const db = {
    collection,
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const pending: Array<{ method: RecordedWrite['method']; path: string; data: Doc; merge: boolean }> = [];
      const tx = {
        async get(target: Ref | Query) {
          return target.kind === 'query' ? target.run() : snap(target.path);
        },
        create(target: Ref, data: Doc) {
          pending.push({ method: 'create', path: target.path, data, merge: false });
          return tx;
        },
        update(target: Ref, data: Doc) {
          pending.push({ method: 'update', path: target.path, data, merge: false });
          return tx;
        },
        set(target: Ref, data: Doc, opts?: { merge?: boolean }) {
          pending.push({ method: 'set', path: target.path, data, merge: opts?.merge === true });
          return tx;
        },
      };
      const result = await fn(tx);
      // A commit is all or nothing: a create of an existing doc fails it before any write.
      const clash = pending.find((w) => w.method === 'create' && docs.has(w.path));
      if (clash) throw codeError(6, `ALREADY_EXISTS: ${clash.path}`);
      for (const w of pending) write(w.method, true, w.path, w.data, w.merge);
      return result;
    },
  };

  // Boundary cast: the double implements only the slice of Firestore the trigger uses.
  return { db: db as unknown as Firestore, writes, docs };
}
