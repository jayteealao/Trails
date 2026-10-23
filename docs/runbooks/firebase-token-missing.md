# Runbook: firebase-token-missing

## When this fires

The rules step of `warg/scripts/deploy.sh` (run with `--with-rules`) stops
before it deploys anything when the operator's shell has no Firebase or Google
Cloud sign-in. Deploy output lines matching any of these patterns point here:

- `(?i)firebase is not signed in`
- `(?i)gcloud is not signed in`

CI no longer deploys the rules: the `firebase-rules.yml` workflow only runs the
rules tests on the emulators and reads no `FIREBASE_TOKEN`.

## Steps

1. Sign in to Firebase in the operator shell: `firebase login` (or set
   `FIREBASE_TOKEN` for that shell only; never commit or log it).
2. Sign in to Google Cloud: `gcloud auth login`. The rules step reads the
   released rulesets through the Firebase Rules API with this sign-in.
3. Re-run the rules deploy from `warg/`:

   ```bash
   pnpm run deploy -- --functions-only --with-rules
   ```

4. Check that the summary rows `rules:firestore` and `rules:storage` read
   `deployed`. `unverified` means a released ruleset hash differs from the
   build copy, and the run exits 3.

## Notes

Rules deploy only through the deploy script (`firebase/README.md`, Deploying),
never by hand, from the Firebase Console or from CI.
