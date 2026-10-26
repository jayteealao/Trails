import { defineSecret } from 'firebase-functions/params';

/**
 * The dashboard's keys are Secret Manager secrets. Read them only inside a
 * request (through `.value()`), never at module load: the platform binds
 * secrets to the environment at run time.
 */

/**
 * The old shared internal key. It is bound and accepted only while the
 * key-rotation switch is on, so the dashboard keeps working while it moves to
 * its own key. With the switch off the function no longer binds it, and its
 * versions can be destroyed.
 */
export const INTERNAL_API_KEY = defineSecret('INTERNAL_API_KEY');
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

/** The secrets the function binds; the old shared key only while the rotation switch is on. */
export function functionSecrets() {
  return [DASHBOARD_API_KEY, ...(dualAcceptOn() ? [INTERNAL_API_KEY] : [])];
}

/** The caller keys accepted now: the dashboard's own key, and the old key while the switch is on ('' when off). */
export function acceptedCallerKeys(): { own: string; old: string } {
  return {
    own: DASHBOARD_API_KEY.value(),
    old: dualAcceptOn() ? INTERNAL_API_KEY.value() : '',
  };
}
