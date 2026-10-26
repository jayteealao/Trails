import type { Response } from 'express';
import { defineString } from 'firebase-functions/params';

/** The single dashboard user. Deploy configuration with no committed default. */
const DASHBOARD_USER_ID = defineString('DASHBOARD_USER_ID', {
  description: 'Firebase uid whose articles the dashboard reads. Required; there is no default.',
});

/** The dashboard user id, or an error that names DASHBOARD_USER_ID when it is not configured. */
export function getDashboardUserId(): string {
  const userId = DASHBOARD_USER_ID.value();
  if (!userId) {
    throw new Error("DASHBOARD_USER_ID is not configured; set it in the function's deploy configuration");
  }
  return userId;
}

/**
 * Resolves the dashboard user once per API-key request. When the deploy
 * configuration has no DASHBOARD_USER_ID it answers 500 and returns false;
 * there is no fallback user.
 */
export function dashboardUserConfigured(res: Response): boolean {
  try {
    getDashboardUserId();
    return true;
  } catch {
    console.error('[dashboard-api] DASHBOARD_USER_ID is not configured');
    res.status(500).json({ error: 'Server misconfigured' });
    return false;
  }
}
