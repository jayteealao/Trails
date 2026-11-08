import { FieldPath, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

// In-memory stand-in for the slice of Firestore the merge and re-derive passes use:
//   collection(name).doc(id)[.collection(sub).doc(id)]   get, update(data, precondition?), set
//   collection.orderBy(FieldPath.documentId()).limit(n).startAfter(id).get()
//   collection('articles').where('normalizedUrl', '==', v).limit(n)  (in a transaction)
//   collection('users').listDocuments()                   users that hold subcollections
//   runTransaction(fn)                                    tx.get(ref | query), create, update, set
//   bulkWriter()                                          update, set, delete, onWriteError, flush, close
// Every document carries an update time (a counter, not the clock), and a
// `lastUpdateTime` precondition that does not match fails that write with
// FAILED_PRECONDITION (code 9). An update of a missing document fails with
// NOT_FOUND (code 5). A transaction commits all or nothing after fn resolves.
// Every write is logged in call order, normalised.

type Doc = Record<string, unknown>;

export interface RecordedWrite {
  method: 'create' | 'set' | 'update' | 'delete';
  via: 'ref' | 'tx' | 'bulk';
  path: string;
  /** The data object, or `{field, value}` for a field-value update (a FieldPath as its segments). */
  data: unknown;
  /** `{merge: true}`, `{lastUpdateTime: '<ts:MILLIS>'}`, or `{}`. */
  options: unknown;
}

/**
 * A Timestamp becomes '<ts:MILLIS>', FieldValue.delete() '<delete>', an
 * increment '<increment:N>', any other sentinel '<fieldvalue>'; maps and arrays
 * are normalised recursively.
 */
export function normalise(value: unknown): unknown {
  if (value instanceof Timestamp) return `<ts:${value.toMillis()}>`;
  if (value instanceof FieldValue) {
    if (value.isEqual(FieldValue.delete())) return '<delete>';
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

/** The segments of a FieldPath. Boundary cast: the SDK keeps them on a non-public field. */
function segmentsOf(path: FieldPath): string[] {
  return [...(path as unknown as { segments: string[] }).segments];
}

function codeError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Writes value at the field path, creating maps on the way; a delete removes the field, an increment adds. */
function setAt(doc: Doc, parts: readonly string[], value: unknown): void {
  let target: Doc = doc;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    target[part] = next && typeof next === 'object' && !(next instanceof Timestamp) ? next : {};
    target = target[part] as Doc;
  }
  const leaf = parts[parts.length - 1]!;
  if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) {
    Reflect.deleteProperty(target, leaf);
  } else if (value instanceof FieldValue && value.isEqual(FieldValue.increment(1))) {
    const current = target[leaf];
    target[leaf] = (typeof current === 'number' ? current : 0) + 1;
  } else {
    target[leaf] = value;
  }
}

/** A copy of doc; values are kept as they are, so a Timestamp stays a Timestamp. */
function copy(doc: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(doc)) {
    out[k] = v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? copy(v as Doc) : v;
  }
  return out;
}

function mergeInto(target: Doc, data: Doc): void {
  for (const [key, value] of Object.entries(data)) {
    const current = target[key];
    if (
      value &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype &&
      current &&
      typeof current === 'object' &&
      Object.getPrototypeOf(current) === Object.prototype
    ) {
      mergeInto(current as Doc, value as Doc);
    } else {
      setAt(target, [key], value);
    }
  }
}

interface Stored {
  data: Doc;
  createTime: Timestamp;
  updateTime: Timestamp;
}

interface Precondition {
  lastUpdateTime?: Timestamp;
}

/** One write to apply: a data object, or one field (dotted string or FieldPath) and its value. */
type Change =
  | { kind: 'create'; data: Doc }
  | { kind: 'set'; data: Doc; merge: boolean }
  | { kind: 'update'; data: Doc; precondition?: Precondition }
  | { kind: 'update-field'; field: string | FieldPath; value: unknown }
  | { kind: 'delete'; precondition?: Precondition };

export function makeRecordingDb(seed: Record<string, Doc> = {}) {
  const docs = new Map<string, Stored>();
  const writes: RecordedWrite[] = [];
  let clock = 1000;
  const tick = (): Timestamp => Timestamp.fromMillis((clock += 1));

  for (const [path, data] of Object.entries(seed)) {
    const time = tick();
    docs.set(path, { data: copy(data), createTime: time, updateTime: time });
  }

  const optionsOf = (change: Change): unknown => {
    if (change.kind === 'create' || change.kind === 'update-field') return {};
    if (change.kind === 'set') return change.merge ? { merge: true } : {};
    return change.precondition ? normalise(change.precondition) : {};
  };

  const record = (via: RecordedWrite['via'], path: string, change: Change): void => {
    const method = change.kind === 'update-field' ? 'update' : change.kind;
    const data =
      change.kind === 'update-field'
        ? {
            field: change.field instanceof FieldPath ? segmentsOf(change.field) : change.field,
            value: normalise(change.value),
          }
        : change.kind === 'delete'
          ? undefined
          : normalise(change.data);
    writes.push({ method, via, path, data, options: optionsOf(change) });
  };

  /** Throws the error Firestore would give this change, without applying it. */
  const check = (path: string, change: Change): void => {
    const stored = docs.get(path);
    if (change.kind === 'create' && stored) throw codeError(6, `ALREADY_EXISTS: ${path}`);
    if ((change.kind === 'update' || change.kind === 'update-field') && !stored) {
      throw codeError(5, `NOT_FOUND: ${path}`);
    }
    const precondition = change.kind === 'update' || change.kind === 'delete' ? change.precondition : undefined;
    if (precondition?.lastUpdateTime && !stored?.updateTime.isEqual(precondition.lastUpdateTime)) {
      throw codeError(9, `FAILED_PRECONDITION: ${path}`);
    }
  };

  const apply = (path: string, change: Change): void => {
    check(path, change);
    const stored = docs.get(path);
    const time = tick();
    if (change.kind === 'delete') {
      docs.delete(path);
      return;
    }
    let data: Doc;
    if (change.kind === 'create' || (change.kind === 'set' && !change.merge)) {
      data = copy(change.data);
    } else if (change.kind === 'set') {
      data = copy(stored?.data ?? {});
      mergeInto(data, change.data);
    } else if (change.kind === 'update') {
      data = copy(stored!.data);
      for (const [key, value] of Object.entries(change.data)) setAt(data, key.split('.'), value);
    } else {
      data = copy(stored!.data);
      const parts = change.field instanceof FieldPath ? segmentsOf(change.field) : change.field.split('.');
      setAt(data, parts, change.value);
    }
    docs.set(path, { data, createTime: stored?.createTime ?? time, updateTime: time });
  };

  const snap = (path: string) => {
    const stored = docs.get(path);
    return {
      id: path.split('/').pop()!,
      ref: ref(path),
      exists: stored !== undefined,
      createTime: stored?.createTime,
      updateTime: stored?.updateTime,
      data: () => (stored ? copy(stored.data) : undefined),
      get: (field: string) => stored?.data[field],
    };
  };

  /** The documents directly under a collection path, by id. */
  const childrenOf = (base: string) =>
    [...docs.keys()]
      .filter((path) => path.startsWith(`${base}/`) && !path.slice(base.length + 1).includes('/'))
      .sort();

  interface QueryState {
    filter?: { field: string; value: unknown };
    after?: string;
    max: number;
  }

  const query = (base: string, state: QueryState) => ({
    kind: 'query' as const,
    orderBy: (field: unknown) => {
      if (!(field instanceof FieldPath) || !field.isEqual(FieldPath.documentId())) {
        throw new Error(`unexpected orderBy on ${base}`);
      }
      return query(base, state);
    },
    limit: (n: number) => query(base, { ...state, max: n }),
    startAfter: (id: string) => query(base, { ...state, after: id }),
    run: () => {
      const paths = childrenOf(base)
        .filter((path) => state.after === undefined || path.split('/').pop()! > state.after)
        .filter((path) => !state.filter || docs.get(path)!.data[state.filter.field] === state.filter.value)
        .slice(0, state.max);
      const found = paths.map(snap);
      return { empty: found.length === 0, size: found.length, docs: found };
    },
    get: async () => query(base, state).run(),
  });

  const ref = (path: string) => ({
    kind: 'ref' as const,
    id: path.split('/').pop()!,
    path,
    get: async () => snap(path),
    update: async (data: Doc, precondition?: Precondition) => {
      const change: Change = { kind: 'update', data, precondition };
      record('ref', path, change);
      apply(path, change);
    },
    set: async (data: Doc, opts?: { merge?: boolean }) => {
      const change: Change = { kind: 'set', data, merge: opts?.merge === true };
      record('ref', path, change);
      apply(path, change);
    },
    collection: (sub: string) => collection(`${path}/${sub}`),
  });

  const collection = (base: string) => ({
    ...query(base, { max: Infinity }),
    doc: (id: string) => ref(`${base}/${id}`),
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unexpected where on ${base}`);
      return query(base, { filter: { field, value }, max: Infinity });
    },
    /** The documents and the ids that hold subcollections directly under this collection. */
    listDocuments: async () => {
      const ids = new Set<string>();
      for (const path of docs.keys()) {
        if (!path.startsWith(`${base}/`)) continue;
        ids.add(path.slice(base.length + 1).split('/')[0]!);
      }
      return [...ids].sort().map((id) => ref(`${base}/${id}`));
    },
  });

  type Target = { kind: 'ref'; path: string } | { kind: 'query'; run: () => unknown };

  const runTransaction = async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const pending: Array<{ path: string; change: Change }> = [];
    const tx = {
      get: async (target: Target) => (target.kind === 'query' ? target.run() : snap(target.path)),
      create: (target: { path: string }, data: Doc) => {
        pending.push({ path: target.path, change: { kind: 'create', data } });
        return tx;
      },
      update: (target: { path: string }, data: Doc) => {
        pending.push({ path: target.path, change: { kind: 'update', data } });
        return tx;
      },
      set: (target: { path: string }, data: Doc, opts?: { merge?: boolean }) => {
        pending.push({ path: target.path, change: { kind: 'set', data, merge: opts?.merge === true } });
        return tx;
      },
    };
    const result = await fn(tx);
    // A commit is all or nothing: every write is checked before any is applied.
    for (const { path, change } of pending) check(path, change);
    for (const { path, change } of pending) {
      record('tx', path, change);
      apply(path, change);
    }
    return result;
  };

  interface BulkError {
    code: unknown;
    message: string;
    failedAttempts: number;
    documentRef: { path: string };
  }

  const bulkWriter = () => {
    let shouldRetry: (error: BulkError) => boolean = () => false;
    let queue: Array<{ path: string; change: Change; resolve: () => void; reject: (e: Error) => void }> = [];

    const enqueue = (target: { path: string }, change: Change): Promise<void> => {
      record('bulk', target.path, change);
      return new Promise<void>((resolve, reject) => {
        queue.push({ path: target.path, change, resolve, reject });
      });
    };

    const flush = async (): Promise<void> => {
      const ops = queue;
      queue = [];
      for (const op of ops) {
        for (let failedAttempts = 1; ; failedAttempts += 1) {
          try {
            apply(op.path, op.change);
            op.resolve();
            break;
          } catch (error) {
            const err = error as Error & { code?: unknown };
            if (shouldRetry({ code: err.code, message: err.message, failedAttempts, documentRef: { path: op.path } })) {
              continue;
            }
            op.reject(err);
            break;
          }
        }
      }
      // Let the per-op catch handlers run before flush resolves, as the SDK does.
      await new Promise((resolve) => setImmediate(resolve));
    };

    return {
      onWriteError: (callback: (error: BulkError) => boolean) => {
        shouldRetry = callback;
      },
      update: (target: { path: string }, dataOrField: Doc | string | FieldPath, ...rest: unknown[]) =>
        typeof dataOrField === 'string' || dataOrField instanceof FieldPath
          ? enqueue(target, { kind: 'update-field', field: dataOrField, value: rest[0] })
          : enqueue(target, { kind: 'update', data: dataOrField, precondition: rest[0] as Precondition | undefined }),
      set: (target: { path: string }, data: Doc, opts?: { merge?: boolean }) =>
        enqueue(target, { kind: 'set', data, merge: opts?.merge === true }),
      delete: (target: { path: string }, precondition?: Precondition) =>
        enqueue(target, { kind: 'delete', precondition }),
      flush,
      close: flush,
    };
  };

  const db = {
    collection,
    runTransaction,
    bulkWriter,
  };

  return {
    // Boundary cast: the double implements only the slice of Firestore the passes use.
    db: db as unknown as Firestore,
    writes,
    /** The stored data of a document, or undefined. */
    read: (path: string): Doc | undefined => {
      const stored = docs.get(path);
      return stored ? copy(stored.data) : undefined;
    },
  };
}
