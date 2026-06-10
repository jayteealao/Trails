export type DebugLogClass = 'legacy-flat' | 'owner-parent' | 'unknown';

export interface DebugLogDoc {
  readonly id: string;
  readonly data: Record<string, unknown> | undefined;
  readonly hasSessionsSubcollection: boolean;
}

/**
 * Classify a top-level `debug_logs/{id}` document for cleanup.
 *
 * - `owner-parent` — has a `sessions` subcollection. This is a uid parent of the
 *   migrated `debug_logs/{uid}/sessions/*` layout and is NEVER deleted. The
 *   subcollection check is decisive even if the parent doc happens to carry
 *   flat-shaped fields.
 * - `legacy-flat` — the old flat session doc shape (`events[]` array +
 *   `sessionId` string + a `device` field) AND no `sessions` subcollection.
 *   This is the only class the cleanup ever deletes.
 * - `unknown` — anything else (missing doc, partial shape). Skipped.
 */
export function classifyDebugLogDoc(doc: DebugLogDoc): DebugLogClass {
  if (doc.hasSessionsSubcollection) return 'owner-parent';

  const data = doc.data;
  if (
    data !== undefined &&
    Array.isArray(data['events']) &&
    typeof data['sessionId'] === 'string' &&
    data['device'] != null
  ) {
    return 'legacy-flat';
  }

  return 'unknown';
}
