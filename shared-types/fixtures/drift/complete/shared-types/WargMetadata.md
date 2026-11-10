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

## Archive kinds

| Archive key | Artifact kind | GCS path | Text | Persist order | App |
| ----------- | ------------- | -------- | ---- | ------------- | --- |
| `readability` | `readability.md` | `readability/output.md.gz` | yes | 1 (text) | yes |
| `ai_markdown` | `ai-markdown.md` | `ai-markdown/output.md.gz` | yes | 1 (text) | yes |
| `rendered` | `rendered.html` | `rendered/output.html.gz` | no | 2 (page) | yes |
| `markdown` | `rendered.md` | `rendered/output.md.gz` | yes | 2 (page) | yes |
| `screenshot` | `screenshot.png` | `screenshot/output.png` | no | 2 (page) | no: fixture, the app does not store it |
| `pdf` | `page.pdf` | `pdf/output.pdf` | no | 2 (page) | no: fixture, the app does not store it |
| `singlefile` | `singlefile.html` | `singlefile/output.html.gz` | no | 3 | yes |
| `monolith` | `monolith.html` | `monolith/output.html.gz` | no | 4 | yes |

## User article fields read by the server

The app writes these names on the user article through `UserArticleWire.kt`.

| Field | Read by |
| ----- | ------- |
| `url` | fixture |
| `title` | fixture |
| `favorite` | fixture |
| `status` | fixture |
| `timeAdded` | fixture |
| `timeRead` | fixture |
| `timeUpdated` | fixture |
| `deletedAt` | fixture |

## Producer

The fixture producer files under `warg/`.
