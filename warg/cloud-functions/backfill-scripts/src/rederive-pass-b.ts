import { resolve } from 'node:path';
import process from 'node:process';

import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { BulkWriter, DocumentData, Firestore, Timestamp } from 'firebase-admin/firestore';
import { linkUserArticle, SharedIdConflictError } from '@warg/user-triggers/dist/shared/link.js';

import {
  listUserIds,
  markersCollection,
  streamSharedArticles,
  streamUserArticles,
  userArticlesCollection,
} from './articles.js';
import { assertTargetEnv, getDb, isMain } from './firebase.js';
import { markerBody } from './keys.js';
import { isSuccessfulArchive } from './merge.js';
import type { ArchiveView } from './merge.js';
import { checkPreconditions, isDeleted, planAll, REDERIVE_MARKER_SOURCE } from './rederive.js';
import type {
  Anomaly,
  ArticleView,
  CreatePlan,
  LinkChange,
  MarkerView,
  MarkerWrite,
  Plan,
  SharedView,
  UserInput,
} from './rederive.js';
import { userLabel, writeJsonReport } from './report.js';

/** gRPC FAILED_PRECONDITION: a document changed after the scan read it. */
const FAILED_PRECONDITION = 9;

export interface RederiveOptions {
  /** Write the plan. False (the default) plans and reports only. */
  readonly apply: boolean;
  readonly pageSize?: number;
  /** Test hook: stop after this write phase, as a crash would. */
  readonly stopAfterPhase?: 1 | 2;
  /** Test hook: runs after phase 1 and before the phase 2 writes. */
  readonly beforePhase2?: () => Promise<void>;
}

/** A write refused because the document changed after the scan; a re-run plans it again. */
export interface Conflict {
  readonly uidLabel: string;
  /** The path below `users/{uid}`, e.g. `articles/<itemId>`. */
  readonly path: string;
  readonly phase: 1 | 2 | 3;
}

export interface RederiveReport {
  readonly mode: 'dry-run' | 'apply';
  readonly target: 'emulator' | 'production';
  readonly generatedAt: string;
  readonly counts: {
    readonly users: number;
    readonly articles: number;
    readonly skippedDeleted: number;
    readonly linkAdds: number;
    readonly linkChanges: number;
    readonly linkClears: number;
    readonly creates: number;
    readonly archiveLoss: number;
    readonly markerAdds: number;
    readonly markerChanges: number;
    readonly markerRemovals: number;
    readonly anomalies: number;
    readonly conflicts: number;
    readonly errors: number;
  };
  readonly preconditionFailures: readonly string[];
  readonly linkChanges: ReadonlyArray<Omit<LinkChange, 'uid'>>;
  readonly creates: ReadonlyArray<Omit<CreatePlan, 'uid' | 'url' | 'clearFirst'>>;
  readonly markerAdds: ReadonlyArray<Omit<MarkerWrite, 'uid'>>;
  readonly markerChanges: ReadonlyArray<Omit<MarkerWrite, 'uid'>>;
  readonly markerRemovals: ReadonlyArray<{
    readonly uidLabel: string;
    readonly key: string;
    readonly source: string | null;
    readonly itemId: string | null;
  }>;
  readonly anomalies: readonly Anomaly[];
  readonly conflicts: readonly Conflict[];
}

export interface RederiveResult {
  readonly apply: boolean;
  /** `apply` was refused because the duplicate merge has not finished; nothing was written. */
  readonly refused: boolean;
  readonly preconditionFailures: readonly string[];
  readonly users: number;
  readonly plan: Plan;
  /** Writes that failed for a reason other than a changed document (`apply` only). */
  readonly errors: number;
  readonly conflicts: readonly Conflict[];
  /** Every planned change, with users named only by their hashed label. */
  readonly report: RederiveReport;
}

function optionalString(data: DocumentData, field: string): string | undefined {
  const value = data[field];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSharedView(id: string, data: DocumentData): SharedView {
  const archives: unknown = data['archives'];
  const hasSuccessArchive =
    isRecord(archives) &&
    Object.values(archives).some((entry) => isRecord(entry) && isSuccessfulArchive(entry as ArchiveView));
  return {
    id,
    url: optionalString(data, 'url'),
    normalizedUrl: optionalString(data, 'normalizedUrl'),
    mergedInto: optionalString(data, 'mergedInto'),
    data,
    hasSuccessArchive,
  };
}

/** The scan of one user, with the update times the write preconditions need. */
interface ScannedUser extends UserInput {
  readonly articleTimes: ReadonlyMap<string, Timestamp>;
  readonly markerTimes: ReadonlyMap<string, Timestamp>;
}

async function scanUser(db: Firestore, uid: string, pageSize: number): Promise<ScannedUser> {
  const uidLabel = userLabel(uid);
  const articles: ArticleView[] = [];
  const articleTimes = new Map<string, Timestamp>();
  for await (const snap of streamUserArticles(db, uid, pageSize)) {
    const data = snap.data();
    articles.push({
      uid,
      uidLabel,
      itemId: snap.id,
      url: optionalString(data, 'url'),
      canonicalId: optionalString(data, 'canonicalId'),
      resolvedId: optionalString(data, 'resolvedId'),
      deleted: isDeleted(data),
    });
    articleTimes.set(snap.id, snap.updateTime);
  }

  // Full marker docs (source, itemId, update time), paged by document id.
  const markers: MarkerView[] = [];
  const markerTimes = new Map<string, Timestamp>();
  const collection = markersCollection(db, uid);
  let cursor: string | null = null;
  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const snap of snapshot.docs) {
      const data = snap.data();
      markers.push({ key: snap.id, source: optionalString(data, 'source'), itemId: optionalString(data, 'itemId') });
      markerTimes.set(snap.id, snap.updateTime);
    }
    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1]!.id;
  }

  return { uid, uidLabel, articles, markers, articleTimes, markerTimes };
}

/**
 * Re-derive the link and the markers of every non-deleted user article.
 *
 * Reads every shared article and every user once, checks that the duplicate
 * merge has finished, and plans every change in memory. With `apply` it then
 * writes in three phases: (1) new shared articles through the save trigger's
 * link function, (2) `canonicalId` writes and server markers, (3) removal of
 * markers that no own URL derives. Every write is guarded by the update time
 * the scan read, and every planned write differs from the stored value, so a
 * re-run writes nothing and a stopped run is finished by running it again.
 * Never writes a deleted article and never writes `articles/{id}` itself.
 */
export async function runRederivePassB(db: Firestore, options: RederiveOptions): Promise<RederiveResult> {
  const { apply } = options;
  const pageSize = options.pageSize ?? 500;

  const shared: SharedView[] = [];
  for await (const snap of streamSharedArticles(db, pageSize)) shared.push(toSharedView(snap.id, snap.data()));
  const preconditionFailures = checkPreconditions(shared);

  const users: ScannedUser[] = [];
  for (const uid of await listUserIds(db)) users.push(await scanUser(db, uid, pageSize));
  const plan = planAll(shared, users);

  const refused = apply && preconditionFailures.length > 0;
  const outcome =
    apply && !refused
      ? await writePlan(db, plan, users, options)
      : { errors: 0, conflicts: [] as Conflict[], anomalies: [] as Anomaly[] };

  const anomalies = [...plan.anomalies, ...outcome.anomalies];
  const linkChanges = plan.linkChanges.map(({ uid: _uid, ...row }) => row);
  const report: RederiveReport = {
    mode: apply ? 'apply' : 'dry-run',
    target: process.env['FIRESTORE_EMULATOR_HOST'] ? 'emulator' : 'production',
    generatedAt: new Date().toISOString(),
    counts: {
      users: users.length,
      articles: plan.articles,
      skippedDeleted: plan.skippedDeleted,
      linkAdds: plan.linkChanges.filter((row) => row.kind === 'add').length,
      linkChanges: plan.linkChanges.filter((row) => row.kind === 'change').length,
      linkClears: plan.linkChanges.filter((row) => row.kind === 'clear').length,
      creates: plan.creates.length,
      archiveLoss:
        plan.linkChanges.filter((row) => row.archiveLoss).length +
        plan.creates.filter((row) => row.archiveLoss).length,
      markerAdds: plan.markerAdds.length,
      markerChanges: plan.markerChanges.length,
      markerRemovals: plan.markerRemovals.length,
      anomalies: anomalies.length,
      conflicts: outcome.conflicts.length,
      errors: outcome.errors,
    },
    preconditionFailures,
    linkChanges,
    creates: plan.creates.map(({ uidLabel, itemId, normalizedUrl, from, archiveLoss }) => ({
      uidLabel,
      itemId,
      normalizedUrl,
      from,
      archiveLoss,
    })),
    markerAdds: plan.markerAdds.map(({ uid: _uid, ...row }) => row),
    markerChanges: plan.markerChanges.map(({ uid: _uid, ...row }) => row),
    markerRemovals: plan.markerRemovals.map(({ uid: _uid, ...row }) => row),
    anomalies,
    conflicts: outcome.conflicts,
  };

  return {
    apply,
    refused,
    preconditionFailures,
    users: users.length,
    plan,
    errors: outcome.errors,
    conflicts: outcome.conflicts,
    report,
  };
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

async function writePlan(
  db: Firestore,
  plan: Plan,
  users: readonly ScannedUser[],
  options: RederiveOptions,
): Promise<{ errors: number; conflicts: Conflict[]; anomalies: Anomaly[] }> {
  let errors = 0;
  const conflicts: Conflict[] = [];
  const anomalies: Anomaly[] = [];
  const byUid = new Map(users.map((user) => [user.uid, user]));
  const articleTime = (uid: string, itemId: string): Timestamp => byUid.get(uid)!.articleTimes.get(itemId)!;
  const markerTime = (uid: string, key: string): Timestamp => byUid.get(uid)!.markerTimes.get(key)!;

  // Phase 1: new shared articles, one link-function transaction each, in plan
  // order. A concurrent save may have linked another id; later writes use the
  // id the link function returns. A failed create maps to null.
  const createdIds = new Map<string, string | null>();
  for (const create of plan.creates) {
    const userRef = userArticlesCollection(db, create.uid).doc(create.itemId);
    try {
      if (create.clearFirst) {
        // The link function stops on any existing canonicalId.
        await userRef.update(
          { canonicalId: FieldValue.delete() },
          { lastUpdateTime: articleTime(create.uid, create.itemId) },
        );
      }
      const outcome = await linkUserArticle(
        db,
        { userId: create.uid, itemId: create.itemId, url: create.url },
        { markerSource: REDERIVE_MARKER_SOURCE },
      );
      createdIds.set(create.itemId, outcome.canonicalId);
    } catch (error) {
      createdIds.set(create.itemId, null);
      if (error instanceof SharedIdConflictError) {
        anomalies.push({
          kind: 'id-conflict',
          uidLabel: create.uidLabel,
          itemId: create.itemId,
          normalizedUrl: create.normalizedUrl,
        });
      } else if (errorCode(error) === FAILED_PRECONDITION) {
        conflicts.push({ uidLabel: create.uidLabel, path: `articles/${create.itemId}`, phase: 1 });
      } else {
        errors += 1;
        console.error(
          `[rederive] create failed user=${create.uidLabel} articles/${create.itemId}: ${(error as Error).message}`,
        );
      }
    }
  }
  if (options.stopAfterPhase === 1) return { errors, conflicts, anomalies };

  if (options.beforePhase2) await options.beforePhase2();

  /** The shared id to write for a planned id: the created one, else the planned one; null when its create failed. */
  const finalId = (id: string): string | null => (createdIds.has(id) ? createdIds.get(id)! : id);

  const writer: BulkWriter = db.bulkWriter();
  // Attach BEFORE enqueuing any op. A changed document is not retried.
  writer.onWriteError((error) => error.code !== FAILED_PRECONDITION && error.failedAttempts < 10);
  const track =
    (uidLabel: string, path: string, phase: 2 | 3) =>
    (error: unknown): void => {
      if (errorCode(error) === FAILED_PRECONDITION) {
        conflicts.push({ uidLabel, path, phase });
        return;
      }
      errors += 1;
      console.error(`[rederive] write failed user=${uidLabel} ${path}: ${(error as Error).message}`);
    };

  try {
    // Phase 2: links, then server markers.
    for (const change of plan.linkChanges) {
      const path = `articles/${change.itemId}`;
      const to = change.to === null ? null : finalId(change.to);
      if (change.to !== null && to === null) {
        conflicts.push({ uidLabel: change.uidLabel, path, phase: 2 });
        continue;
      }
      const data = to === null ? { canonicalId: FieldValue.delete() } : { canonicalId: to, resolvedId: to };
      writer
        .update(userArticlesCollection(db, change.uid).doc(change.itemId), data, {
          lastUpdateTime: articleTime(change.uid, change.itemId),
        })
        .catch(track(change.uidLabel, path, 2));
    }
    for (const write of [...plan.markerAdds, ...plan.markerChanges]) {
      const key = finalId(write.key);
      if (key === null) {
        conflicts.push({ uidLabel: write.uidLabel, path: `articleMarkers/${write.key}`, phase: 2 });
        continue;
      }
      writer
        .set(markersCollection(db, write.uid).doc(key), markerBody(key, write.itemId, REDERIVE_MARKER_SOURCE))
        .catch(track(write.uidLabel, `articleMarkers/${key}`, 2));
    }
    await writer.flush();
    if (options.stopAfterPhase === 2) return { errors, conflicts, anomalies };

    // Phase 3: markers no own URL derives, last, so no correct marker is lost
    // first. A marker rewritten since the scan fails its precondition.
    for (const removal of plan.markerRemovals) {
      writer
        .delete(markersCollection(db, removal.uid).doc(removal.key), {
          lastUpdateTime: markerTime(removal.uid, removal.key),
        })
        .catch(track(removal.uidLabel, `articleMarkers/${removal.key}`, 3));
    }
  } finally {
    await writer.close();
  }
  return { errors, conflicts, anomalies };
}

export interface RederiveCliArgs {
  readonly apply: boolean;
  readonly yes: boolean;
  readonly reportPath: string;
  readonly pageSize: number;
}

const USAGE =
  'usage: node dist/rederive-pass-b.js [--apply] [--yes] [--report <path>] [--page-size <n>]';

/** `20261022T171500Z` style stamp, in UTC. */
function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Parse the re-derive CLI flags. Dry run unless `--apply`; unknown flags throw. */
export function parseRederiveArgs(argv: readonly string[], now = new Date()): RederiveCliArgs {
  let apply = false;
  let yes = false;
  let reportPath = resolve(process.cwd(), 'tmp', `rederive-pass-b-${utcStamp(now)}.json`);
  let pageSize = 500;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') apply = true;
    else if (flag === '--yes') yes = true;
    else if (flag === '--report' || flag === '--page-size') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value\n${USAGE}`);
      }
      i += 1;
      if (flag === '--report') {
        reportPath = resolve(process.cwd(), value);
      } else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`--page-size must be a positive integer, got "${value}"\n${USAGE}`);
        }
        pageSize = parsed;
      }
    } else {
      throw new Error(`unknown flag "${flag}"\n${USAGE}`);
    }
  }

  return { apply, yes, reportPath, pageSize };
}

/**
 * The CLI: target banner, the pass, the report file and a one-line summary.
 * Exit code 2 when `--apply` is refused because the duplicate merge has not
 * finished, 1 when any write failed or met a changed document, else 0.
 * Users appear only by their hashed label.
 */
export async function runCli(
  argv: readonly string[],
  db?: Firestore,
  hooks: Pick<RederiveOptions, 'stopAfterPhase' | 'beforePhase2'> = {},
): Promise<{ result: RederiveResult; reportPath: string; exitCode: number }> {
  const args = parseRederiveArgs(argv);
  await assertTargetEnv(args.yes);

  const result = await runRederivePassB(db ?? getDb(), {
    apply: args.apply,
    pageSize: args.pageSize,
    ...hooks,
  });
  await writeJsonReport(args.reportPath, result.report);

  const { counts } = result.report;
  console.log(
    `[rederive] mode=${args.apply ? 'APPLY' : 'dry-run'} users=${counts.users} articles=${counts.articles}` +
      ` skippedDeleted=${counts.skippedDeleted} linkAdds=${counts.linkAdds} linkChanges=${counts.linkChanges}` +
      ` linkClears=${counts.linkClears} creates=${counts.creates} archiveLoss=${counts.archiveLoss}` +
      ` markerAdds=${counts.markerAdds} markerChanges=${counts.markerChanges}` +
      ` markerRemovals=${counts.markerRemovals} anomalies=${counts.anomalies}` +
      ` conflicts=${counts.conflicts} errors=${counts.errors}`,
  );
  console.log(`[rederive] report: ${args.reportPath}`);

  let exitCode = 0;
  if (result.refused) {
    console.error(
      '[rederive] the duplicate merge has not finished — run merge-pass-a (dry run, then --apply) first',
    );
    exitCode = 2;
  } else if (result.errors + result.conflicts.length > 0) {
    console.error('[rederive] some writes did not apply — re-run with --apply, then run the dry run again');
    exitCode = 1;
  } else if (!args.apply) {
    console.log('[rederive] dry-run — review the report, then re-run with --apply');
  }
  if (exitCode !== 0) process.exitCode = exitCode;
  return { result, reportPath: args.reportPath, exitCode };
}

if (isMain(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
