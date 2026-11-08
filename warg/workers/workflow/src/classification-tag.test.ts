import { describe, expect, it } from 'vitest';
import { readClassificationTag, withClassificationTag } from './classification-tag.js';
import { classifyError } from './logging.js';

const unreachable = {
  errorCode: 'RENDER_SERVICE_ERROR',
  retryable: false,
  recommendedAction: 'inspect_url',
} as const;

describe('classification tag', () => {
  it('reads back the classification written into a message', () => {
    const message = withClassificationTag('Service error 502: dial tcp: no such host', unreachable);
    expect(readClassificationTag(message)).toEqual(unreachable);
  });

  it('reads the tag inside a message wrapped by later text', () => {
    const message = `Step failed: render: ${withClassificationTag('boom', unreachable)} (attempt 1)`;
    expect(readClassificationTag(message)).toEqual(unreachable);
  });

  it('finds nothing in an untagged message or a tag with an unknown code', () => {
    expect(readClassificationTag('Service error 503: Service Unavailable')).toBeUndefined();
    expect(readClassificationTag('x [classified NOT_A_CODE final inspect_url]')).toBeUndefined();
  });
});

describe('classifyError on a tagged step failure', () => {
  it('keeps the classification of the step over the text rules', () => {
    // The text alone reads as a retryable network close; the step judged it final.
    const message = withClassificationTag('Service error 502: network closed 5006', unreachable);
    expect(classifyError('render', message)).toEqual(unreachable);
  });
});
