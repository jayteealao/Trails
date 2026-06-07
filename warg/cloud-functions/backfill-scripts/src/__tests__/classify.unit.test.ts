import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyDebugLogDoc } from '../classify.js';

test('classify: legacy-flat = events[] + sessionId + device, no sessions subcollection', () => {
  const cls = classifyDebugLogDoc({
    id: 'abc12345_session',
    data: { events: [], sessionId: 'abc12345', device: 'Pixel 7' },
    hasSessionsSubcollection: false,
  });
  assert.equal(cls, 'legacy-flat');
});

test('classify: owner-parent = has a sessions subcollection (never deleted)', () => {
  const cls = classifyDebugLogDoc({
    id: 'uid-1',
    data: undefined,
    hasSessionsSubcollection: true,
  });
  assert.equal(cls, 'owner-parent');
});

test('classify: subcollection guard wins even when flat-shaped fields are present', () => {
  const cls = classifyDebugLogDoc({
    id: 'uid-1',
    data: { events: [], sessionId: 's', device: 'p' },
    hasSessionsSubcollection: true,
  });
  assert.equal(cls, 'owner-parent');
});

test('classify: unknown when device is missing', () => {
  const cls = classifyDebugLogDoc({
    id: 'x',
    data: { events: [], sessionId: 's' },
    hasSessionsSubcollection: false,
  });
  assert.equal(cls, 'unknown');
});

test('classify: unknown when events is not an array', () => {
  const cls = classifyDebugLogDoc({
    id: 'x',
    data: { events: 'nope', sessionId: 's', device: 'p' },
    hasSessionsSubcollection: false,
  });
  assert.equal(cls, 'unknown');
});

test('classify: unknown for a missing/empty doc with no subcollection', () => {
  const cls = classifyDebugLogDoc({
    id: 'x',
    data: undefined,
    hasSessionsSubcollection: false,
  });
  assert.equal(cls, 'unknown');
});
