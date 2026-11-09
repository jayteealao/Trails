import { ARCHIVE_OPTION_BOOLEAN_KEYS, WORKFLOW_STEPS, type ArchiveOptions } from '@warg/shared';

/**
 * The largest archive options object the gateway stores, in UTF-8 bytes of its JSON.
 */
export const MAX_OPTIONS_BYTES = 16 * 1024;

/**
 * Largest /begin body read and parsed. It leaves room above MAX_OPTIONS_BYTES for the
 * request id and dropped keys, and stops an oversized body before JSON parsing.
 */
export const MAX_BEGIN_BODY_BYTES = 4 * MAX_OPTIONS_BYTES;

/** Longest caller-supplied key name written to a log line. */
export const MAX_LOGGED_KEY_LENGTH = 64;

/**
 * The archive option keys a public-key caller may not send: only the internal key
 * chooses a dry run or the step list. Their presence, whatever the value, is refused.
 */
export const PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS = ['dryRun', 'steps'] as const;

/**
 * Archive options as the gateway stores them: only known keys, each of the right type.
 * The url is optional here; the begin handler checks its presence and format.
 */
export type GatewayArchiveOptions = Omit<ArchiveOptions, 'url'> & { url?: string };

/**
 * Every ArchiveOptions key that validateArchiveOptions checks and keeps. Adding a key to
 * ArchiveOptions without a check here fails to compile instead of being dropped at /begin.
 */
const VALIDATED_OPTION_KEYS = {
  url: true,
  steps: true,
  includeScreenshot: true,
  includePdf: true,
  includeMarkdown: true,
  resumeFromCheckpoint: true,
  dryRun: true
} as const satisfies Record<keyof ArchiveOptions, true>;

function isValidatedOptionKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(VALIDATED_OPTION_KEYS, key);
}

/**
 * True for a JSON object value: not null, not an array, not a primitive.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BOOLEAN_KEYS: ReadonlySet<string> = new Set(ARCHIVE_OPTION_BOOLEAN_KEYS);
const STEP_NAMES: ReadonlySet<string> = new Set(WORKFLOW_STEPS);

/**
 * Check the types of the archive option fields and keep only the known keys.
 * Unknown keys are dropped and named in droppedKeys; the first wrong-typed field,
 * or a kept object over MAX_OPTIONS_BYTES, fails with a message naming it.
 */
export function validateArchiveOptions(
  fields: Record<string, unknown>
): { ok: true; options: GatewayArchiveOptions; droppedKeys: string[] } | { ok: false; message: string } {
  const options: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!isValidatedOptionKey(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (key === 'url') {
      if (typeof value !== 'string') return { ok: false, message: 'url must be a string' };
    } else if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') return { ok: false, message: `${key} must be a boolean` };
    } else if (key === 'steps') {
      if (!Array.isArray(value) || !value.every((step) => typeof step === 'string' && STEP_NAMES.has(step))) {
        return { ok: false, message: `steps must be an array of ${WORKFLOW_STEPS.join(', ')}` };
      }
    }
    options[key] = value;
  }
  if (new TextEncoder().encode(JSON.stringify(options)).byteLength > MAX_OPTIONS_BYTES) {
    return { ok: false, message: `options exceed ${MAX_OPTIONS_BYTES} bytes` };
  }
  return { ok: true, options: options as GatewayArchiveOptions, droppedKeys };
}
