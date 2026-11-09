import { defineSecret } from 'firebase-functions/params';

/**
 * The dashboard's keys are Secret Manager secrets. Read them only inside a
 * request (through `.value()`), never at module load: the platform binds
 * secrets to the environment at run time.
 */

/** The dashboard's own key: the only caller key this function accepts once the rotation ends. */
export const DASHBOARD_API_KEY = defineSecret('DASHBOARD_API_KEY');

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
 * dashboard keeps working while it moves to its own key. With the switch off
 * the function does not declare it at all: firebase-tools checks every
 * declared secret at deploy, and the old key's destroyed versions would block
 * the deploy. Declared once per process, on first use with the switch on.
 */
export function oldInternalKey(): ReturnType<typeof defineSecret> | undefined {
  if (!dualAcceptOn()) return undefined;
  oldKey ??= defineSecret('INTERNAL_API_KEY');
  return oldKey;
}

/** The secrets the function binds; the old shared key only while the rotation switch is on. */
export function functionSecrets() {
  const old = oldInternalKey();
  return [DASHBOARD_API_KEY, ...(old ? [old] : [])];
}

/** The caller keys accepted now: the dashboard's own key, and the old key while the switch is on ('' when off). */
export function acceptedCallerKeys(): { own: string; old: string } {
  return {
    own: DASHBOARD_API_KEY.value(),
    old: oldInternalKey()?.value() ?? '',
  };
}
