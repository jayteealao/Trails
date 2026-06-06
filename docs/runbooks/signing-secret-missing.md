# Runbook: signing-secret-missing

## When this fires

CI logs matching any of the following patterns trigger this runbook:

- `(?i)No release keystore configured`
- `(?i)Using debug signing`
- `(?i)present=false`

## Steps

1. Confirm the four signing secrets exist on the repo: SIGNING_STORE_FILE_B64, SIGNING_STORE_PASSWORD, SIGNING_KEY_ALIAS, SIGNING_KEY_PASSWORD.
2. If missing, base64-encode the release keystore and set SIGNING_STORE_FILE_B64; set the three password/alias secrets.
3. Re-run the release workflow for the same tag (delete and re-push the tag, or re-run from the Actions UI).

## Notes

_Operational runbook for the Android release pipeline. Update as the process evolves._
