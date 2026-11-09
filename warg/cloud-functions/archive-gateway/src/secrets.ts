import { defineSecret } from 'firebase-functions/params';

/**
 * Every key this function holds is a Secret Manager secret. Read a value only
 * inside a request (through `.value()` or `requireSecret`), never at module
 * load: the platform binds secrets to the environment at run time.
 */

/** The storage worker's own key: the only caller key this function accepts once the rotation ends. */
export const ARCHIVE_GATEWAY_KEY = defineSecret('ARCHIVE_GATEWAY_KEY');
/** The key this function sends to the gateway worker's event log endpoint. */
export const GATEWAY_LOG_KEY = defineSecret('GATEWAY_LOG_KEY');
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

/**
 * The key-rotation switch, from the function's deploy configuration. Only the
 * exact value `true` turns it on; anything else, unset included, is off. Read
 * per call: the same value decides at deploy time whether the old key is bound
 * and at run time whether it is accepted.
 */
export function dualAcceptOn(): boolean {
  return process.env['KEY_ROTATION_DUAL_ACCEPT'] === 'true';
}

let oldKey: ReturnType<typeof defineSecret> | undefined;

/**
 * The old shared internal key, or undefined while the key-rotation switch is
 * off. It is declared, bound and accepted only while the switch is on, so the
 * storage worker keeps archiving while it moves to its own key. With the
 * switch off the function does not declare it at all: firebase-tools checks
 * every declared secret at deploy, and the old key's destroyed versions would
 * block the deploy. Declared once per process, on first use with the switch on.
 */
export function oldInternalKey(): ReturnType<typeof defineSecret> | undefined {
  if (!dualAcceptOn()) return undefined;
  oldKey ??= defineSecret('INTERNAL_API_KEY');
  return oldKey;
}

/** The secrets the function binds; the old shared key only while the rotation switch is on. */
export function functionSecrets() {
  const old = oldInternalKey();
  return [
    ARCHIVE_GATEWAY_KEY,
    GATEWAY_LOG_KEY,
    CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET,
    ...(old ? [old] : []),
  ];
}

/** The caller keys accepted now: the storage worker's own key, and the old key while the switch is on ('' when off). */
export function acceptedCallerKeys(): { own: string; old: string } {
  return {
    own: ARCHIVE_GATEWAY_KEY.value(),
    old: oldInternalKey()?.value() ?? '',
  };
}
