import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, test } from 'vitest';
import { POCKET_FIELDS, projectPocket } from './index.js';

// The pocket map on the documents stored today. The app reads no pocket field;
// the dashboard returns the stored map in the article detail and declares
// favorite, resolved_id and status strings and time_added and time_read
// numbers. The projection must keep those names and types.

const SHARED = 'item1234';

const POCKET_TYPES = {
  favorite: 'string',
  resolved_id: 'string',
  status: 'string',
  time_added: 'number',
  time_read: 'number',
};

/** The field names and value types of a pocket map, in key order. */
const shapeOf = (pocket: object) =>
  Object.fromEntries(Object.entries(pocket).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, typeof value]));

/** A user article with the keys of the app's backup (Article.toBackupFields). */
const appUserArticle = {
  itemId: SHARED,
  title: 'A',
  givenTitle: 'A',
  url: 'https://example.com/a',
  givenUrl: 'https://example.com/a',
  normalizedUrl: 'example.com/a',
  excerpt: '',
  wordCount: 0,
  favorite: '0',
  status: '0',
  wordCountMessage: '',
  image: null,
  hasImage: '0',
  hasVideo: '0',
  hasAudio: '0',
  sortId: 0,
  timeAdded: 1_700_000_000,
  timeUpdated: 1_700_000_000,
  timeRead: null,
  timeFavorited: 0,
  timeToRead: 0,
  listenDurationEstimate: 0,
  text: null,
  articleId: null,
  resolved: 0,
  deletedAt: null,
  archivedAt: null,
  textSource: null,
  backedUpAt: 1_700_000_000,
};

/** A user article as the dashboard queues it (enqueueUserArticle). */
const dashboardUserArticle = {
  url: 'https://example.com/a',
  favorite: '',
  status: '',
  timeAdded: Timestamp.fromMillis(1_700_000_000_000),
  timeRead: 0,
  resolvedId: SHARED,
  archival_triggered: false,
  queued_at: Timestamp.fromMillis(1_700_000_000_000),
  queued_by: 'dashboard',
};

/** The pocket map the save trigger stores today on a shared article it creates for an app save. */
const storedByTrigger = { favorite: '0', resolved_id: '', status: '0', time_added: 1_700_000_000, time_read: 0 };
/** The pocket map the backfill stores today on a shared article it creates. */
const storedByBackfill = { favorite: '0', resolved_id: SHARED, status: '0', time_added: 1_700_000_000, time_read: 0 };

describe('the pocket projection on stored documents', () => {
  test('the pocket field list has the five names the readers read', () => {
    expect([...POCKET_FIELDS].sort()).toEqual(Object.keys(POCKET_TYPES).sort());
  });

  for (const [name, userDoc] of [
    ['an app-backed-up user article', appUserArticle],
    ['a dashboard-queued user article', dashboardUserArticle],
  ] as const) {
    test(`${name} projects to exactly the five pocket fields as strings and numbers`, () => {
      expect(shapeOf(projectPocket(userDoc, SHARED))).toEqual(POCKET_TYPES);
    });
  }

  test('an app-backed-up user article keeps its values', () => {
    expect(projectPocket(appUserArticle, SHARED)).toStrictEqual({
      favorite: '0',
      resolved_id: SHARED,
      status: '0',
      time_added: 1_700_000_000,
      time_read: 0,
    });
  });

  test('a dashboard-queued user article stores its timeAdded as seconds', () => {
    expect(projectPocket(dashboardUserArticle, SHARED).time_added).toBe(1_700_000_000);
  });

  for (const [name, stored] of [
    ['the save trigger', storedByTrigger],
    ['the backfill', storedByBackfill],
  ] as const) {
    test(`a pocket map stored by ${name} has the projection's names and types`, () => {
      expect(shapeOf(stored)).toEqual(shapeOf(projectPocket(appUserArticle, SHARED)));
    });
  }
});
