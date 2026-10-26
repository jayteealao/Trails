import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { getApps } from 'firebase-admin/app';

const LINK_MODULE = '@warg/user-triggers/dist/shared/link.js';

// `firebase-admin/package.json` is not in the package's exports map, so the
// check resolves an exported subpath (`firebase-admin/firestore`) instead.
// repro: require.resolve('firebase-admin/package.json') -> ERR_PACKAGE_PATH_NOT_EXPORTED.
const FIRESTORE_ENTRY = 'firebase-admin/firestore';

test('backfill-scripts and the save trigger link module resolve one firebase-admin copy', () => {
  const here = createRequire(import.meta.url);
  const linkPath = realpathSync(here.resolve(LINK_MODULE));
  const fromLink = createRequire(pathToFileURL(linkPath));

  const ours = realpathSync(here.resolve(FIRESTORE_ENTRY));
  const theirs = realpathSync(fromLink.resolve(FIRESTORE_ENTRY));

  // The Firestore serializer accepts FieldValue and Timestamp only from its own
  // copy, so the link function cannot write through our Firestore otherwise.
  assert.equal(theirs, ours, 'backfill-scripts and user-triggers must resolve one firebase-admin');
});

test('importing the link module initializes no Firebase app', async () => {
  const before = getApps().length;
  const link = (await import(LINK_MODULE)) as Record<string, unknown>;

  assert.equal(typeof link['linkUserArticle'], 'function');
  assert.equal(getApps().length, before);
});
