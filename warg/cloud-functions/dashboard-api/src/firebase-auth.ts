import { getAuth } from 'firebase-admin/auth';
import type { Request, Response } from 'express';

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies an ID token and returns the uid + sign-in provider. Injectable so
 * the middleware can be unit-tested without the Admin SDK or a real token; the
 * production default delegates to the Admin SDK's Auth singleton.
 *
 * Note: getAuth() is NOT called at module scope — route modules are imported
 * before index.ts runs initializeApp(), so an eager call would throw "default
 * app does not exist". Calling it inside the verifier (at request time) is
 * safe; the Admin SDK caches the Auth instance and the public signing keys
 * internally, so per-request calls are cheap.
 */
export type IdTokenVerifier = (
  token: string
) => Promise<{ uid: string; signInProvider: string }>;

const defaultVerifier: IdTokenVerifier = async (token) => {
  const decoded = await getAuth().verifyIdToken(token);
  return { uid: decoded.uid, signInProvider: decoded.firebase.sign_in_provider };
};

/**
 * Verify a Firebase ID token from the `Authorization: Bearer <token>` header.
 *
 * - Missing/malformed header or unverifiable token → 401.
 * - Anonymous Firebase users (real uid, `sign_in_provider === 'anonymous'`)
 *   are explicitly rejected → 403. Anonymous accounts own no articles, but we
 *   reject before any Firestore work so the signing lane is never reachable by
 *   an unauthenticated identity.
 * - Otherwise the decoded uid is handed to `next`.
 */
export async function verifyFirebaseToken(
  req: Request,
  res: Response,
  next: (uid: string) => Promise<void>,
  verify: IdTokenVerifier = defaultVerifier
): Promise<void> {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  let uid: string;
  let signInProvider: string;
  try {
    const result = await verify(token);
    uid = result.uid;
    signInProvider = result.signInProvider;
  } catch (err) {
    console.error(
      '[firebase-auth] verifyIdToken failed:',
      err instanceof Error ? err.message : 'unknown error'
    );
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if (signInProvider === 'anonymous') {
    res.status(403).json({ error: 'Anonymous users are not permitted' });
    return;
  }

  await next(uid);
}
