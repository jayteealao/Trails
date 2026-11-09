import type { Firestore } from 'firebase-admin/firestore';

// In-memory stand-in for the slice of Firestore the dashboard readers use:
//   articles/{id}                       get, set (merge), create, getAll
//   users/{uid}/articles/{id}           get, set (merge), create, orderBy()…get(), count()
//   users/{uid}/articles doc()          a new id: auto-id-0001, auto-id-0002, …
//   users/{uid}/articleMarkers/{id}     get
// Every document read is logged by path; a query on `articles` throws, so a test
// fails if a reader looks a shared article up by URL.

type Doc = Record<string, unknown>;

export interface FakeLog {
  reads: string[];
  /** Every set() call in order; `merge` is true only for `{ merge: true }`. */
  writes: Array<{ path: string; data: Doc; merge: boolean }>;
  /** Every create() call that stored its doc, in order. */
  creates: Array<{ path: string; data: Doc }>;
  getAllCalls: number;
  /** count() aggregations run; they read no document. */
  countCalls?: number;
}

export function makeFakeDb(seed: {
  articles?: Record<string, Doc>;
  userArticles?: Record<string, Doc>;
  markers?: Record<string, Doc>;
}): { db: Firestore; log: FakeLog } {
  const articles = { ...seed.articles };
  const userArticles = { ...seed.userArticles };
  const markers = { ...seed.markers };
  const log: FakeLog = { reads: [], writes: [], creates: [], getAllCalls: 0 };
  let autoIds = 0;

  const ref = (path: string, store: Record<string, Doc>, id: string) => ({
    id,
    path,
    async get() {
      log.reads.push(path);
      const data = store[id];
      return { id, exists: data !== undefined, data: () => data };
    },
    async set(data: Doc, opts?: { merge?: boolean }) {
      log.writes.push({ path, data, merge: opts?.merge === true });
      store[id] = opts?.merge ? { ...store[id], ...data } : data;
    },
    async create(data: Doc) {
      if (store[id] !== undefined) {
        throw Object.assign(new Error(`ALREADY_EXISTS: ${path}`), { code: 6 });
      }
      log.creates.push({ path, data });
      store[id] = data;
    },
  });

  const db = {
    collection(name: string) {
      if (name === 'articles') {
        return {
          doc: (id: string) => ref(`articles/${id}`, articles, id),
          where() {
            throw new Error('unexpected query on articles');
          },
        };
      }
      if (name === 'users') {
        return {
          doc: (uid: string) => ({
            collection(sub: string) {
              const store = sub === 'articleMarkers' ? markers : userArticles;
              const base = `users/${uid}/${sub}`;
              return {
                doc: (given?: string) => {
                  const id = given ?? `auto-id-${String((autoIds += 1)).padStart(4, '0')}`;
                  return ref(`${base}/${id}`, store, id);
                },
                orderBy() {
                  // Chainable: ordering, cursors, offset and limit are accepted and
                  // ignored; get() returns every doc in insertion order.
                  const query = {
                    orderBy: () => query,
                    startAfter: () => query,
                    offset: () => query,
                    limit: () => query,
                    async get() {
                      log.reads.push(base);
                      const docs = Object.entries(store).map(([id, data]) => ({
                        id,
                        data: () => data,
                        ref: ref(`${base}/${id}`, store, id),
                      }));
                      return { empty: docs.length === 0, docs };
                    },
                    count: () => ({
                      async get() {
                        log.countCalls = (log.countCalls ?? 0) + 1;
                        return { data: () => ({ count: Object.keys(store).length }) };
                      },
                    }),
                  };
                  return query;
                },
              };
            },
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
    async getAll(...refs: Array<ReturnType<typeof ref>>) {
      log.getAllCalls += 1;
      return Promise.all(refs.map((r) => r.get()));
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the readers use.
  return { db: db as unknown as Firestore, log };
}
