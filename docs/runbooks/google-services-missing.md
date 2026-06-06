# Runbook: google-services-missing

## When this fires

CI logs matching any of the following patterns trigger this runbook:

- `(?i)GOOGLE_SERVICES_JSON_B64 is empty`
- `(?i)google-services.json.*(malformed|invalid)`

## Steps

1. Base64-encode a valid android/app/google-services.json for the trails-e428e Firebase project.
2. Set the GOOGLE_SERVICES_JSON_B64 repo secret.
3. Re-run the release workflow.

## Notes

_Operational runbook for the Android release pipeline. Update as the process evolves._
