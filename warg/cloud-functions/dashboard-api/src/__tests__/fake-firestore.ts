import type { Firestore } from 'firebase-admin/firestore';

// In-memory stand-in for the slice of Firestore the dashboard readers use:
//   articles/{id}                       get, set (merge), getAll
//   users/{uid}/articles/{id}           get, set (merge), orderBy()…get(), count()
//   users/{uid}/articleMarkers/{id}     get
// Every document read is logged by path; a query on `articles` throws, so a test
// fails if a reader looks a shared article up by URL.

type Doc = Record<string, unknown>;

export interface FakeLog {
  reads: string[];
  writes: Array<{ path: string; data: Doc }>;
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
  const log: FakeLog = { reads: [], writes: [], getAllCalls: 0 };

  const ref = (path: string, store: Record<string, Doc>, id: string) => ({
    id,
    path,
    async get() {
      log.reads.push(path);
      const data = store[id];
      return { id, exists: data !== undefined, data: () => data };
    },
    async set(data: Doc, opts?: { merge?: boolean }) {
      log.writes.push({ path, data });
      store[id] = opts?.merge ? { ...store[id], ...data } : data;
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
                doc: (id: string) => ref(`${base}/${id}`, store, id),
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
