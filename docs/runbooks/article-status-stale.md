# Runbook: article-status-stale

## When this fires

CI logs matching any of the following patterns trigger this runbook:

- `(?i)status.*(stale|stuck|processing)`
- `(?i)reconcile.*archives`

## Steps

1. Pause the backfill scheduler before reconciling.
2. Run the reconcilers from warg/scripts: reconcile-status.mjs and reconcile-archives-map.mjs (dry-run first, then --apply).
3. Resume the backfill scheduler only after the --apply pass completes. See warg/plans/article-status-recovery.md.

## Notes

_Operational runbook for Firestore article-status reconciliation. Update as the process evolves._
