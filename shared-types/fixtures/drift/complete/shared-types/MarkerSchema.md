# Fixture: marker contract

A minimal copy of the sections of `shared-types/MarkerSchema.md` that the drift
check reads.

## Firestore field names

| Field       | Type      | Required | Notes |
| ----------- | --------- | -------- | ----- |
| `key`       | string    | required |       |
| `itemId`    | string    | required |       |
| `createdAt` | timestamp | required |       |
| `source`    | string    | required |       |

## Server-owned link fields

| Field         | Lives on                        | Notes |
| ------------- | ------------------------------- | ----- |
| `canonicalId` | `users/{uid}/articles/{itemId}` |       |
| `mergedInto`  | `articles/{id}`                 |       |
