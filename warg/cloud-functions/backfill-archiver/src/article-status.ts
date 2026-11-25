// The status rule lives in @warg/article-writer, shared with the archive retry.
export {
  deriveStatus,
  hasAnySuccessfulArchive,
  hasSufficientArtifact,
  MAX_RETRIES,
  STUCK_TIMEOUT_MS,
  SUFFICIENT_ARCHIVES,
  type ArticleStatus,
} from '@warg/article-writer';
