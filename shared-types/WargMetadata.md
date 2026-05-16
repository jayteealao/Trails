# Canonical schema: `articles/{itemId}.metadata`

This is the wire-format source of truth for the metadata block that Warg
writes to Firestore and Trails reads. It is enforced by
`shared-types/check-drift.ts`, which runs in CI for both Android and Warg
workflows.

## Firestore field names (snake_case)

These are the literal Firestore document field names that both stacks
agree on. **Renaming any of these requires updating both consumers in the
same commit.**

| Field          | Type             | Producer (Warg) | Consumer (Trails) | Notes |
| -------------- | ---------------- | --------------- | ----------------- | ----- |
| `title`        | string           | required        | optional read     |       |
| `excerpt`      | string           | required        | optional read     |       |
| `byline`       | string           | required        | optional read     |       |
| `word_count`   | number (int)     | required        | optional read     | Kotlin maps to camelCase `wordCount` |
| `published_time` | string \| null | required        | not consumed yet  | Warg-only for now |
| `site_name`    | string \| null   | required        | not consumed yet  | Warg-only for now |

## Producer

Warg writes these fields via `FinalizeRequest.metadata` defined in
[`warg/cloud-functions/archive-gateway/src/types.ts`](../warg/cloud-functions/archive-gateway/src/types.ts).
The Firestore document shape is also typed there as `ArticleDocument`.

## Consumer

Trails reads four of these fields via `WargMetadata` defined in
[`android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt`](../android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt).
Trails treats all of them as nullable in case the Warg pipeline hasn't
finalized yet.

## Adding a new field

1. Add a row to the table above.
2. Add it to `FinalizeRequest.metadata` and `ArticleDocument.metadata` in
   `warg/cloud-functions/archive-gateway/src/types.ts`.
3. Optionally add it to Trails' `WargMetadata` data class if Trails needs
   to surface it.
4. Update `firebase/firestore.rules` if the field has a validation rule.
5. Run `node --experimental-strip-types shared-types/check-drift.ts`
   locally to confirm.
