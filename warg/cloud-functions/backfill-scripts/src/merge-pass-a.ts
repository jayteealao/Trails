import { resolve } from 'node:path';
import process from 'node:process';

import { FieldPath } from 'firebase-admin/firestore';
import type { BulkWriter, DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import {
  listUserIds,
  markersCollection,
  readExistingMarkerKeys,
  sharedArticlesCollection,
  streamSharedArticles,
  streamUserArticles,
  userArticlesCollection,
} from './articles.js';
import { assertTargetEnv, getDb, isMain } from './firebase.js';
import { markerBody } from './keys.js';
import { markerNeedsFor, planLinkMoves, planSharedArticles } from './merge.js';
import type {
  Anomaly,
  ArchiveView,
  GroupPlan,
  LinkMove,
  MarkerNeed,
  NormalizedUrlWrite,
  SharedDocView,
  UserArticleView,
} from './merge.js';
import { userLabel, writeJsonReport } from './report.js';

/** Provenance recorded on the winner markers the merge adds. */
export const MERGE_MARKER_SOURCE = 'merge';

export interface MergeOptions {
  /** Write the plan. False (the default) plans and reports only. */
  readonly apply: boolean;
  readonly pageSize?: number;
  /** Test hook: stop after this write phase, as a crash would. */
  readonly stopAfterPhase?: 1 | 2;
}

export interface MergeResult {
  readonly apply: boolean;
  readonly sharedArticles: number;
  readonly groups: readonly GroupPlan[];
  readonly losers: number;
  readonly normalizedUrlWrites: readonly NormalizedUrlWrite[];
  readonly archiveCopies: number;
  readonly linkMoves: readonly LinkMove[];
  readonly markerAdds: readonly MarkerNeed[];
  readonly stubWrites: number;
  readonly anomalies: readonly Anomaly[];
  /** Writes the BulkWriter gave up on (`apply` only). */
  readonly errors: number;
  /** Every planned change, with users named only by their hashed label. */
  readonly report: MergeReport;
}

export interface MergeReport {
  readonly mode: 'dry-run' | 'apply';
  readonly target: 'emulator' | 'production';
  readonly generatedAt: string;
  readonly counts: {
    readonly sharedArticles: number;
    readonly groups: number;
    readonly losers: number;
    readonly archiveCopies: number;
    readonly linkMoves: number;
    readonly markerAdds: number;
    readonly stubWrites: number;
    readonly normalizedUrlWrites: number;
    readonly anomalies: number;
    readonly errors: number;
  };
  readonly groups: ReadonlyArray<{
    readonly normalizedUrl: string;
    readonly winner: { readonly id: string; readonly createdAt: string };
    readonly losers: ReadonlyArray<{
      readonly id: string;
      readonly createdAt: string;
      readonly mergedInto: string | null;
    }>;
    readonly archiveCopies: ReadonlyArray<{ readonly key: string; readonly fromId: string }>;
    readonly stubWrites: readonly string[];
    readonly linkMoves: number;
  }>;
  readonly linkMoves: ReadonlyArray<{
    readonly user: string;
    readonly itemId: string;
    readonly from: string;
    readonly to: string;
  }>;
  readonly markerAdds: ReadonlyArray<{
    readonly user: string;
    readonly key: string;
    readonly itemId: string;
  }>;
  readonly normalizedUrlWrites: readonly NormalizedUrlWrite[];
  readonly anomalies: readonly Anomaly[];
}

function optionalString(data: DocumentData, field: string): string | undefined {
  const value = data[field];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a shared article into the planner's view. */
export function toSharedDocView(snap: QueryDocumentSnapshot<DocumentData>): SharedDocView {
  const data = snap.data();
  const createdAt: unknown = data['created_at'];
  const createdMillis =
    isRecord(createdAt) && typeof createdAt['toMillis'] === 'function'
      ? (createdAt['toMillis'] as () => number)()
      : snap.createTime.toMillis();

  const archives: Record<string, ArchiveView> = {};
  const rawArchives: unknown = data['archives'];
  if (isRecord(rawArchives)) {
    for (const [key, entry] of Object.entries(rawArchives)) {
      if (isRecord(entry)) archives[key] = entry as ArchiveView;
    }
  }

  const metadata: unknown = data['metadata'];
  return {
    id: snap.id,
    url: optionalString(data, 'url'),
    normalizedUrl: optionalString(data, 'normalizedUrl'),
    mergedInto: optionalString(data, 'mergedInto'),
    createdMillis,
    archives,
    hasMetadata: isRecord(metadata) && Object.keys(metadata).length > 0,
  };
}

/**
 * Merge shared articles that share a normalized URL.
 *
 * Reads every shared article and, when any group has a loser, every user
 * article; plans every change in memory; and, with `apply`, writes it in three
 * phases: (1) winner archives and every `normalizedUrl`, (2) user
 * `canonicalId` and winner markers, (3) loser `mergedInto`. Each planned write
 * differs from the stored value, so a re-run writes nothing and a stopped run
 * is finished by running it again. Never deletes.
 */
export async function runMergePassA(db: Firestore, options: MergeOptions): Promise<MergeResult> {
  const { apply } = options;
  const pageSize = options.pageSize ?? 500;

  const docs: SharedDocView[] = [];
  for await (const snap of streamSharedArticles(db, pageSize)) docs.push(toSharedDocView(snap));
  const plan = planSharedArticles(docs);

  const linkMoves: LinkMove[] = [];
  const markerAdds: MarkerNeed[] = [];
  if (plan.loserToWinner.size > 0) {
    const winnerIds = new Set(plan.groups.map((group) => group.winnerId));
    for (const uid of await listUserIds(db)) {
      const uidLabel = userLabel(uid);
      const articles: UserArticleView[] = [];
      for await (const snap of streamUserArticles(db, uid, pageSize)) {
        const data = snap.data();
        articles.push({
          uid,
          uidLabel,
          itemId: snap.id,
          canonicalId: optionalString(data, 'canonicalId'),
          resolvedId: optionalString(data, 'resolvedId'),
        });
      }
      const moves = planLinkMoves(articles, plan.loserToWinner);
      const needs = markerNeedsFor(articles, moves, winnerIds);
      linkMoves.push(...moves);
      if (needs.length === 0) continue;
      const existing = await readExistingMarkerKeys(db, uid);
      markerAdds.push(...needs.filter((need) => !existing.has(need.key)));
    }
  }

  const archiveCopies = plan.groups.reduce((sum, group) => sum + group.archiveCopies.length, 0);
  const stubWrites = plan.groups.reduce((sum, group) => sum + group.stubWrites.length, 0);
  const errors = apply
    ? await writePlan(
        db,
        plan.groups,
        plan.normalizedUrlWrites,
        linkMoves,
        markerAdds,
        options.stopAfterPhase,
      )
    : 0;

  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const createdAt = (id: string): string =>
    new Date(docsById.get(id)?.createdMillis ?? 0).toISOString();
  const report: MergeReport = {
    mode: apply ? 'apply' : 'dry-run',
    target: process.env['FIRESTORE_EMULATOR_HOST'] ? 'emulator' : 'production',
    generatedAt: new Date().toISOString(),
    counts: {
      sharedArticles: docs.length,
      groups: plan.groups.length,
      losers: plan.loserToWinner.size,
      archiveCopies,
      linkMoves: linkMoves.length,
      markerAdds: markerAdds.length,
      stubWrites,
      normalizedUrlWrites: plan.normalizedUrlWrites.length,
      anomalies: plan.anomalies.length,
      errors,
    },
    groups: plan.groups.map((group) => ({
      normalizedUrl: group.normalizedUrl,
      winner: { id: group.winnerId, createdAt: createdAt(group.winnerId) },
      losers: group.loserIds.map((id) => ({
        id,
        createdAt: createdAt(id),
        mergedInto: docsById.get(id)?.mergedInto ?? null,
      })),
      archiveCopies: group.archiveCopies.map(({ key, fromId }) => ({ key, fromId })),
      stubWrites: group.stubWrites.map((stub) => stub.id),
      linkMoves: linkMoves.filter((move) => move.to === group.winnerId).length,
    })),
    linkMoves: linkMoves.map(({ uidLabel, itemId, from, to }) => ({
      user: uidLabel,
      itemId,
      from,
      to,
    })),
    markerAdds: markerAdds.map(({ uidLabel, key, itemId }) => ({ user: uidLabel, key, itemId })),
    normalizedUrlWrites: plan.normalizedUrlWrites,
    anomalies: plan.anomalies,
  };

  return {
    apply,
    sharedArticles: docs.length,
    groups: plan.groups,
    losers: plan.loserToWinner.size,
    normalizedUrlWrites: plan.normalizedUrlWrites,
    archiveCopies,
    linkMoves,
    markerAdds,
    stubWrites,
    anomalies: plan.anomalies,
    errors,
    report,
  };
}

async function writePlan(
  db: Firestore,
  groups: readonly GroupPlan[],
  normalizedUrlWrites: readonly NormalizedUrlWrite[],
  linkMoves: readonly LinkMove[],
  markerAdds: readonly MarkerNeed[],
  stopAfterPhase: 1 | 2 | undefined,
): Promise<number> {
  let errors = 0;
  const writer: BulkWriter = db.bulkWriter();
  // Attach BEFORE enqueuing any op. BulkWriter retries UNAVAILABLE/ABORTED
  // itself; this decides when to give up and counts the failure.
  writer.onWriteError((error) => {
    if (error.failedAttempts < 10) return true;
    errors += 1;
    console.error(
      `[merge] write failed (${error.failedAttempts} attempts) ${error.documentRef.path}: ${error.message}`,
    );
    return false;
  });
  // The per-op catch only absorbs the final rejection after onWriteError gave up.
  const ignore = (): undefined => undefined;
  const shared = sharedArticlesCollection(db);

  try {
    // Phase 1: the winner gains archives; every shared article gets normalizedUrl.
    for (const group of groups) {
      const winner = shared.doc(group.winnerId);
      for (const copy of group.archiveCopies) {
        writer.update(winner, new FieldPath('archives', copy.key), copy.entry).catch(ignore);
      }
    }
    for (const write of normalizedUrlWrites) {
      writer.update(shared.doc(write.id), 'normalizedUrl', write.normalizedUrl).catch(ignore);
    }
    await writer.flush();
    if (stopAfterPhase === 1) return errors;

    // Phase 2: user links move to the winner, with a winner marker.
    for (const move of linkMoves) {
      writer
        .update(userArticlesCollection(db, move.uid).doc(move.itemId), 'canonicalId', move.to)
        .catch(ignore);
    }
    for (const add of markerAdds) {
      writer
        .set(
          markersCollection(db, add.uid).doc(add.key),
          markerBody(add.key, add.itemId, MERGE_MARKER_SOURCE),
          { merge: true },
        )
        .catch(ignore);
    }
    await writer.flush();
    if (stopAfterPhase === 2) return errors;

    // Phase 3: losers become stubs, last, so a stopped run leaves every reader working.
    for (const group of groups) {
      for (const stub of group.stubWrites) {
        writer.update(shared.doc(stub.id), 'mergedInto', stub.mergedInto).catch(ignore);
      }
    }
  } finally {
    await writer.close();
  }
  return errors;
}

export interface MergeCliArgs {
  readonly apply: boolean;
  readonly yes: boolean;
  readonly reportPath: string;
  readonly pageSize: number;
}

const USAGE =
  'usage: node dist/merge-pass-a.js [--apply] [--yes] [--report <path>] [--page-size <n>]';

/** `merge-pass-a-20261022T171500Z.json` style stamp, in UTC. */
function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Parse the merge CLI flags. Dry run unless `--apply`; unknown flags throw. */
export function parseMergeArgs(argv: readonly string[], now = new Date()): MergeCliArgs {
  let apply = false;
  let yes = false;
  let reportPath = resolve(process.cwd(), 'tmp', `merge-pass-a-${utcStamp(now)}.json`);
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

/** The CLI: target banner, the pass, the report file and a one-line summary. */
export async function runCli(
  argv: readonly string[],
  db?: Firestore,
): Promise<{ result: MergeResult; reportPath: string }> {
  const args = parseMergeArgs(argv);
  await assertTargetEnv(args.yes);

  const result = await runMergePassA(db ?? getDb(), {
    apply: args.apply,
    pageSize: args.pageSize,
  });
  await writeJsonReport(args.reportPath, result.report);

  const { counts } = result.report;
  console.log(
    `[merge] mode=${args.apply ? 'APPLY' : 'dry-run'} groups=${counts.groups} losers=${counts.losers}` +
      ` archiveCopies=${counts.archiveCopies} linkMoves=${counts.linkMoves} markerAdds=${counts.markerAdds}` +
      ` normalizedUrlWrites=${counts.normalizedUrlWrites} anomalies=${counts.anomalies} errors=${counts.errors}`,
  );
  console.log(`[merge] report: ${args.reportPath}`);
  if (!args.apply) {
    console.log('[merge] dry-run — review the report, then re-run with --apply');
  }
  if (result.errors > 0) process.exitCode = 1;
  return { result, reportPath: args.reportPath };
}

if (isMain(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
