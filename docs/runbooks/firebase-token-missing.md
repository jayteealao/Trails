# Runbook: firebase-token-missing

## When this fires

CI logs matching any of the following patterns trigger this runbook:

- `(?i)FIREBASE_TOKEN secret not set`
- `(?i)skipping deploy`

## Steps

1. Generate a CI token: firebase login:ci.
2. Set the FIREBASE_TOKEN repo secret.
3. Re-run the firebase-rules workflow (push to main on firebase/** or dispatch manually).

## Notes

_Operational runbook for the Android release pipeline. Update as the process evolves._
