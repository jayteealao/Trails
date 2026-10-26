import { defineSecret, defineString } from 'firebase-functions/params';
import { hasValidInternalApiKey } from './auth.js';

/**
 * Every key this module holds is a Secret Manager secret, and the backfill
 * user is deploy configuration with no committed default. Read each value only
 * inside a run or a request, never at module load: the platform binds secrets
 * to the environment at run time.
 */
export const PUBLIC_API_KEY = defineSecret('PUBLIC_API_KEY');
/**
 * The old shared internal key. The status endpoint binds and accepts it only
 * while the key-rotation switch is on, so the dashboard keeps working while it
 * moves to its own key. With the switch off it is no longer bound, and its
 * versions can be destroyed.
 */
export const INTERNAL_API_KEY = defineSecret('INTERNAL_API_KEY');
/** The dashboard's own key for the backfill status endpoint: the only key it accepts once the rotation ends. */
export const BACKFILL_STATUS_KEY = defineSecret('BACKFILL_STATUS_KEY');
export const CF_ACCESS_CLIENT_ID = defineSecret('CF_ACCESS_CLIENT_ID');
export const CF_ACCESS_CLIENT_SECRET = defineSecret('CF_ACCESS_CLIENT_SECRET');
export const BACKFILL_USER_ID = defineString('BACKFILL_USER_ID', {
  description: 'Firebase uid whose saved articles the backfill archives. Required; there is no default.',
});

/** Returns the secret's value, or throws an error that names the secret when it is empty. */
export function requireSecret(param: { name: string; value(): string }): string {
  const value = param.value();
  if (!value) {
    throw new Error(`${param.name} is not configured; create it as a Secret Manager secret`);
  }
  return value;
}

/** The backfill user id, or an error that names BACKFILL_USER_ID when it is not configured. */
export function getBackfillUserId(): string {
  const userId = BACKFILL_USER_ID.value();
  if (!userId) {
    throw new Error("BACKFILL_USER_ID is not configured; set it in the function's deploy configuration");
  }
  return userId;
}

/**
 * The key-rotation switch, from the function's deploy configuration. Only the
 * exact value `true` turns it on; anything else, unset included, is off. Read
 * per call: the same value decides at deploy time whether the old key is bound
 * and at run time whether it is accepted.
 */
export function dualAcceptOn(): boolean {
  return process.env['KEY_ROTATION_DUAL_ACCEPT'] === 'true';
}

/** The secrets the status endpoint binds; the old shared key only while the rotation switch is on. */
export function statusSecrets() {
  return [BACKFILL_STATUS_KEY, ...(dualAcceptOn() ? [INTERNAL_API_KEY] : [])];
}

/**
 * Constant-time check of a provided key against the status endpoint's own key
 * and, while the rotation switch is on, the old shared key. Both comparisons
 * run before they are combined, so the time taken does not depend on which
 * key matched. Values are read at call time.
 */
export function statusKeyMatches(provided: string | null | undefined): boolean {
  const ownMatch = hasValidInternalApiKey(provided, BACKFILL_STATUS_KEY.value());
  const oldMatch = dualAcceptOn() && hasValidInternalApiKey(provided, INTERNAL_API_KEY.value());
  return ownMatch || oldMatch;
}

/** The gateway /begin client configuration, read at call time. Throws before any network call when the public key is empty. */
export function gatewayBeginConfig(gatewayUrl: string) {
  return {
    gatewayUrl,
    publicApiKey: requireSecret(PUBLIC_API_KEY),
    cfAccessClientId: CF_ACCESS_CLIENT_ID.value(),
    cfAccessClientSecret: CF_ACCESS_CLIENT_SECRET.value(),
  };
}
