import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

// A small in-memory Firestore for the backfill tests. It keeps Timestamp values
// as they are (a structured clone would drop toMillis), compares them by millis,
// and logs every read so a test can count them: each document returned by a
// get, getAll, transaction get or query is one read; a count is one aggregation.

export type ReadLogEntry =
  | { kind: 'doc'; path: string }
  | {
      kind: 'query';
      path: string;
      filters: Array<[string, string, unknown]>;
      docsReturned: number;
      ids: string[];
    }
  | { kind: 'count'; path: string; filters: Array<[string, string, unknown]> };

const DOC_ID = '__name__';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clone(v)) as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as T;
  }
  return value;
}

function applyWrite(
  current: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean
): Record<string, unknown> {
  const out: Record<string, unknown> = merge && current ? clone(current) : {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof FieldValue) {
      if (value.isEqual(FieldValue.delete())) {
        Reflect.deleteProperty(out, key);
      } else if (value.isEqual(FieldValue.increment(1))) {
        const prev = out[key];
        out[key] = (typeof prev === 'number' ? prev : 0) + 1;
      } else {
        out[key] = value;
      }
      continue;
    }
    if (merge && isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = applyWrite(out[key] as Record<string, unknown>, value, true);
      continue;
    }
    out[key] = clone(value);
  }
  return out;
}

function comparable(value: unknown): unknown {
  return value instanceof Timestamp ? value.toMillis() : value;
}

function compareKeys(a: unknown[], b: unknown[], directions: Array<'asc' | 'desc'>): number {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number | string;
    const y = b[i] as number | string;
    const sign = directions[i] === 'desc' ? -1 : 1;
    if (x < y) return -1 * sign;
    if (x > y) return 1 * sign;
  }
  return 0;
}

interface QueryState {
  where: Array<[string, string, unknown]>;
  order: Array<{ field: string; dir: 'asc' | 'desc' }>;
  startAfter: unknown[] | null;
  offset: number;
  limit: number | null;
}

export interface FakeFirestore {
  db: Firestore;
  store: Map<string, Record<string, unknown>>;
  log: ReadLogEntry[];
  /** Reads the stored document (no log entry). */
  read(path: string): Record<string, unknown> | undefined;
  /** Writes a document directly (no log entry). */
  put(path: string, data: Record<string, unknown>): void;
}

export function makeFakeFirestore(): FakeFirestore {
  const store = new Map<string, Record<string, unknown>>();
  const log: ReadLogEntry[] = [];

  const snapshot = (path: string, data: Record<string, unknown> | undefined): any => ({
    id: path.split('/').pop(),
    exists: data !== undefined,
    ref: docRef(path),
    data: () => (data === undefined ? undefined : clone(data)),
    get: (field: string) => data?.[field],
  });

  const write = (path: string, data: Record<string, unknown>, options?: { merge?: boolean }): void => {
    store.set(path, applyWrite(store.get(path), data, options?.merge === true));
  };

  const docRef = (path: string): any => ({
    path,
    id: path.split('/').pop(),
    get: async () => {
      log.push({ kind: 'doc', path });
      return snapshot(path, store.get(path));
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      write(path, data, options);
    },
    update: async (data: Record<string, unknown>) => {
      if (!store.has(path)) throw new Error(`NOT_FOUND: ${path}`);
      write(path, data, { merge: true });
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  });

  const rowsOf = (base: string): Array<{ path: string; id: string; data: Record<string, unknown> }> =>
    [...store.entries()]
      .filter(([key]) => key.startsWith(`${base}/`) && !key.slice(base.length + 1).includes('/'))
      .map(([key, data]) => ({ path: key, id: key.split('/').pop()!, data }));

  const run = (base: string, state: QueryState) => {
    let rows = rowsOf(base);
    for (const [field, op, value] of state.where) {
      rows = rows.filter((row) => {
        const v = comparable(field === DOC_ID ? row.id : row.data[field]);
        const w = comparable(value);
        if (v === undefined) return false;
        switch (op) {
          case '==':
            return v === w;
          case '>=':
            return typeof v === typeof w && (v as number) >= (w as number);
          default:
            throw new Error(`fake: unsupported operator ${op}`);
        }
      });
    }
    // An ordered field must exist on the document, as in Firestore.
    for (const { field } of state.order) {
      if (field !== DOC_ID) rows = rows.filter((row) => row.data[field] !== undefined);
    }
    const order = state.order.length > 0 ? state.order : [{ field: DOC_ID, dir: 'asc' as const }];
    const keyOf = (row: { id: string; data: Record<string, unknown> }) =>
      order.map(({ field }) => comparable(field === DOC_ID ? row.id : row.data[field]));
    const dirs = order.map((o) => o.dir);
    rows.sort((a, b) => compareKeys(keyOf(a), keyOf(b), dirs));
    if (state.startAfter) {
      const cursor = state.startAfter.map(comparable);
      rows = rows.filter(
        (row) => compareKeys(keyOf(row).slice(0, cursor.length), cursor, dirs) > 0
      );
    }
    rows = rows.slice(state.offset);
    if (state.limit !== null) rows = rows.slice(0, state.limit);
    return rows;
  };

  const query = (base: string, state: QueryState): any => ({
    where: (field: unknown, op: string, value: unknown) =>
      query(base, {
        ...state,
        where: [...state.where, [typeof field === 'string' ? field : DOC_ID, op, value]],
      }),
    orderBy: (field: unknown, dir: 'asc' | 'desc' = 'asc') =>
      query(base, {
        ...state,
        order: [...state.order, { field: typeof field === 'string' ? field : DOC_ID, dir }],
      }),
    startAfter: (...values: unknown[]) => query(base, { ...state, startAfter: values }),
    offset: (n: number) => query(base, { ...state, offset: n }),
    limit: (n: number) => query(base, { ...state, limit: n }),
    get: async () => {
      const rows = run(base, state);
      log.push({
        kind: 'query',
        path: base,
        filters: state.where,
        docsReturned: rows.length,
        ids: rows.map((r) => r.id),
      });
      const docs = rows.map((r) => snapshot(r.path, r.data));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
    count: () => ({
      get: async () => {
        const n = run(base, { ...state, startAfter: null, offset: 0, limit: null }).length;
        log.push({ kind: 'count', path: base, filters: state.where });
        return { data: () => ({ count: n }) };
      },
    }),
  });

  const collectionRef = (base: string): any => ({
    ...query(base, { where: [], order: [], startAfter: null, offset: 0, limit: null }),
    doc: (id: string) => docRef(`${base}/${id}`),
  });

  const db: any = {
    doc: (path: string) => docRef(path),
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: Array<{ path: string }>) =>
      refs.map((ref) => {
        log.push({ kind: 'doc', path: ref.path });
        return snapshot(ref.path, store.get(ref.path));
      }),
    runTransaction: async (cb: (tx: any) => Promise<unknown>) =>
      cb({
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, unknown>, options?: { merge?: boolean }) => {
          write(ref.path, data, options);
        },
        update: (ref: any, data: Record<string, unknown>) => {
          write(ref.path, data, { merge: true });
        },
      }),
  };

  return {
    db: db as Firestore,
    store,
    log,
    read: (path) => {
      const data = store.get(path);
      return data === undefined ? undefined : clone(data);
    },
    put: (path, data) => {
      store.set(path, clone(data));
    },
  };
}
