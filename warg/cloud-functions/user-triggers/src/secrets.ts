import { defineSecret } from 'firebase-functions/params';

/**
 * Every key this function holds is a Secret Manager secret. Read a value only
 * inside a trigger run (through `.value()` or the helpers below), never at
 * module load: the platform binds secrets to the environment at run time.
 */
export const PUBLIC_API_KEY = defineSecret('PUBLIC_API_KEY');
export const CF_ACCESS_CLIENT_ID = defineSecret('CF_ACCESS_CLIENT_ID');
export const CF_ACCESS_CLIENT_SECRET = defineSecret('CF_ACCESS_CLIENT_SECRET');

/** Returns the secret's value, or throws an error that names the secret when it is empty. */
export function requireSecret(param: { name: string; value(): string }): string {
  const value = param.value();
  if (!value) {
    throw new Error(`${param.name} is not configured; create it as a Secret Manager secret`);
  }
  return value;
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
