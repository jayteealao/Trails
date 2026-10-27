import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A short, stable label for a user id: the first 12 hex characters of its
 * SHA-256. Reports and logs name users only by this label, never by the id.
 */
export function userLabel(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

/**
 * A document path with its user id replaced by that user's label, so a log
 * line can name the document without naming the user.
 */
export function labelPath(path: string): string {
  return path.replace(/^users\/([^/]+)/, (_match, uid: string) => `users/${userLabel(uid)}`);
}

/** Write `data` as indented JSON, creating the parent folder when needed. */
export async function writeJsonReport(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
