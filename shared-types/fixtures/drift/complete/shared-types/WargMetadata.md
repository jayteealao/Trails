# Fixture: canonical metadata contract

A minimal copy of the sections of `shared-types/WargMetadata.md` that the drift
check reads. The drift check test copies this tree and breaks one file per case.

## Firestore field names (snake_case)

| Field          | Type             | Producer (Warg) | Consumer (Trails) | Notes |
| -------------- | ---------------- | --------------- | ----------------- | ----- |
| `title`        | string           | required        | optional read     |       |
| `excerpt`      | string           | required        | optional read     |       |
| `byline`       | string           | required        | optional read     |       |
| `word_count`   | number (int)     | required        | optional read     |       |
| `published_time` | string \| null | required        | not consumed yet  |       |
| `site_name`    | string \| null   | required        | not consumed yet  |       |
| `lead_image`   | string \| null   | required        | optional read     |       |

## Accepted differences

| Field | Not found in | Reason |
| ----- | ------------ | ------ |
| `published_time` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt` | fixture: the app does not read the published time |
| `site_name` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt` | fixture: the app does not read the site name |

## Producer

The fixture producer files under `warg/`.
