#!/usr/bin/env node
// Seeds and inspects the local Firebase emulators for the archive-view check of a
// user article whose shared article id (canonicalId) differs from its own itemId.
//
// Emulators only: every request goes to the --firestore and --auth hosts given on
// the command line, and the "Bearer owner" token is the emulator's admin bypass.
// No key, secret or real user id is used.
//
// Start the emulators first, from firebase/test (the config sits beside the rules
// file, because the Firebase CLI refuses a rules path outside the config folder):
//   npx firebase emulators:start --config ../emulator-harness.json \
//     --only firestore,auth --project trails-e428e
//
// Usage:
//   node seed-canonical-fixture.mjs <command> [--item <id>] \
//     --firestore 127.0.0.1:8787 --auth 127.0.0.1:9099 --project trails-e428e
//
//   seed           writes the fixture for the single signed-in (anonymous) emulator account
//   markers        lists every marker doc of that account with its source
//   user-articles  lists the account's article doc ids and whether each has a resolvedId field
//   text-first     --item <id>: writes articles/<id> with its Readability and Monolith archives
//                  both finished, and the account's marker for it
//   heavy-first    --item <id>: the same, with the Readability archive still uploading
//   text-ready     --item <id>: marks the Readability archive of articles/<id> finished
//   archive-failed --item <id>: writes articles/<id> with status failed and no archive, and the
//                  account's marker for it
//
// text-first, heavy-first and text-ready serve the check that a large archive that is still
// downloading does not hold back the text: run the stub with --stall monolith, and store the
// article in the app first with the debug broadcast READER_SEED_EMPTY and the same id.
// archive-failed serves the check of the Reader's failed notice: store the article in the app
// first with READER_SEED_EMPTY and the same id.

const ITEM_ID = 'fixtureAlias01';
const SHARED_ID = 'fixtureShared01';
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const COMMANDS = ['seed', 'markers', 'user-articles', 'text-first', 'heavy-first', 'text-ready', 'archive-failed'];
const ITEM_COMMANDS = ['text-first', 'heavy-first', 'text-ready', 'archive-failed'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) {
    throw new Error(`unknown command '${command ?? ''}' (${COMMANDS.join(' | ')})`);
  }
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    if (!key || rest[i + 1] === undefined) throw new Error(`missing value for ${rest[i]}`);
    opts[key] = rest[i + 1];
  }
  for (const required of ['firestore', 'auth', 'project']) {
    if (!opts[required]) throw new Error(`--${required} is required`);
  }
  if (ITEM_COMMANDS.includes(command) && !opts.item) throw new Error(`--item is required for ${command}`);
  return { command, ...opts };
}

async function request(method, url, body) {
  const res = await fetch(url, { method, headers: OWNER, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function onlyUid({ auth, project }) {
  const url = `http://${auth}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet?maxResults=10`;
  const { users = [] } = await request('GET', url);
  if (users.length !== 1) {
    throw new Error(`expected exactly one emulator account (sign in once in the app), found ${users.length}`);
  }
  return users[0].localId;
}

function docsBase({ firestore, project }) {
  return `http://${firestore}/v1/projects/${project}/databases/(default)/documents`;
}

// Firestore REST value encoding for the plain values this fixture uses.
function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
}

function fields(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encode(v)]));
}

async function seed(opts) {
  const uid = await onlyUid(opts);
  const base = docsBase(opts);
  const now = Date.now();

  // The user's own article: its itemId has no shared doc; canonicalId names the shared one.
  await request('PATCH', `${base}/users/${uid}/articles/${ITEM_ID}`, {
    fields: fields({
      itemId: ITEM_ID,
      title: 'Canonical fixture',
      givenTitle: 'Canonical fixture',
      url: 'https://example.com/canonical-fixture',
      givenUrl: 'https://example.com/canonical-fixture',
      status: '0',
      timeAdded: now,
      timeUpdated: now,
      canonicalId: SHARED_ID,
    }),
  });

  // The shared article with one finished archive. No articles/<ITEM_ID> doc is created,
  // so a read by itemId shows nothing.
  await request('PATCH', `${base}/articles/${SHARED_ID}`, {
    fields: fields({
      archives: { readability: { status: 'success', gcs_path: 'gs://fixture/readability.html' } },
    }),
  });

  // The server-written marker that lets this user read the shared article.
  await request('PATCH', `${base}/users/${uid}/articleMarkers/${SHARED_ID}`, {
    fields: fields({ key: SHARED_ID, itemId: ITEM_ID, createdAt: new Date(now), source: 'fixture' }),
  });

  console.log(`seeded users/<uid>/articles/${ITEM_ID} (canonicalId=${SHARED_ID}), articles/${SHARED_ID}, marker ${SHARED_ID}`);
}

const READY = (path) => ({ status: 'success', gcs_path: `gs://fixture/${path}` });

// A shared article read by the app's own itemId (no canonicalId), with a Monolith archive the
// stub stalls and a Readability archive that is finished, or still uploading when textReady is false.
async function seedTextFirst(opts, textReady) {
  const uid = await onlyUid(opts);
  const base = docsBase(opts);
  const id = opts.item;
  await request('PATCH', `${base}/articles/${id}`, {
    fields: fields({
      archives: {
        monolith: READY('monolith.html'),
        readability: textReady ? READY('readability.md') : { status: 'uploading' },
      },
    }),
  });
  await request('PATCH', `${base}/users/${uid}/articleMarkers/${id}`, {
    fields: fields({ key: id, itemId: id, createdAt: new Date(), source: 'fixture' }),
  });
  console.log(`seeded articles/${id} (monolith success, readability ${textReady ? 'success' : 'uploading'}), marker ${id}`);
}

async function markTextReady(opts) {
  const id = opts.item;
  await request('PATCH', `${docsBase(opts)}/articles/${id}?updateMask.fieldPaths=archives.readability`, {
    fields: fields({ archives: { readability: READY('readability.md') } }),
  });
  console.log(`articles/${id} readability success`);
}

// A shared article the archive pipeline gave up on: status failed, no usable archive.
async function seedArchiveFailed(opts) {
  const uid = await onlyUid(opts);
  const base = docsBase(opts);
  const id = opts.item;
  await request('PATCH', `${base}/articles/${id}`, {
    fields: fields({
      status: 'failed',
      error: 'fixture: archive failed',
      failed_at: new Date(),
      archives: {},
    }),
  });
  await request('PATCH', `${base}/users/${uid}/articleMarkers/${id}`, {
    fields: fields({ key: id, itemId: id, createdAt: new Date(), source: 'fixture' }),
  });
  console.log(`seeded articles/${id} (status failed, no archives), marker ${id}`);
}

async function list(opts, collection) {
  const uid = await onlyUid(opts);
  const { documents = [] } = await request('GET', `${docsBase(opts)}/users/${uid}/${collection}?pageSize=300`);
  return documents.map((doc) => ({ id: doc.name.split('/').pop(), fields: doc.fields ?? {} }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.command) {
    case 'seed':
      await seed(opts);
      break;
    case 'markers':
      for (const { id, fields: f } of await list(opts, 'articleMarkers')) {
        console.log(`marker ${id} source=${f.source?.stringValue ?? '<none>'}`);
      }
      break;
    case 'user-articles':
      for (const { id, fields: f } of await list(opts, 'articles')) {
        console.log(`article ${id} resolvedId=${'resolvedId' in f ? 'present' : 'absent'}`);
      }
      break;
    case 'text-first':
      await seedTextFirst(opts, true);
      break;
    case 'heavy-first':
      await seedTextFirst(opts, false);
      break;
    case 'text-ready':
      await markTextReady(opts);
      break;
    case 'archive-failed':
      await seedArchiveFailed(opts);
      break;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
