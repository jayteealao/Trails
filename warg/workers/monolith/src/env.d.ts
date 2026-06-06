interface Env {
  INTERNAL_API_KEY: string;
  MONOLITH_SERVICE_URL?: string;

  // R2 S3-API presign (B1b). The Sandbox fetches rendered HTML from a presigned
  // GET URL over its own network instead of the host->container writeFile RPC.
  // R2_BUCKET_NAME is a plain var (wrangler.jsonc); the rest are secrets.
  R2_BUCKET_NAME: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}
