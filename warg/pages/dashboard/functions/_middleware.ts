// Every dashboard page and API call needs the dashboard credential. The
// browser's own sign-in prompt asks for it (HTTP Basic) and then sends it
// with every later request. A dashboard with no credential configured lets
// nobody in, and says so with a 500 instead of a sign-in prompt that can
// never succeed.

interface Env {
  // The dashboard credential, as `user:password`.
  DASHBOARD_AUTH?: string;
}

const CHALLENGE_HEADER = 'Basic realm="Warg dashboard", charset="UTF-8"';
const BASIC_CREDENTIAL = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i;

function signInRequired(): Response {
  return new Response('Sign-in required.', {
    status: 401,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': CHALLENGE_HEADER,
    },
  });
}

// No challenge header: a browser shows the line instead of prompting for a
// credential that cannot match.
function authNotConfigured(): Response {
  return new Response('Dashboard auth is not configured.', {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// The raw bytes of a Basic credential, or undefined when the header is not one.
function credentialBytes(header: string | null): Uint8Array | undefined {
  const token = header?.match(BASIC_CREDENTIAL)?.[1];
  if (!token) return undefined;
  let decoded: string;
  try {
    decoded = atob(token);
  } catch {
    return undefined; // Not valid base64: treated as no credential.
  }
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

// Both sides are hashed first, so the comparison takes the same time whatever
// the guess, its length included.
async function matchesSecret(candidate: Uint8Array, secret: string): Promise<boolean> {
  const [candidateDigest, secretDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', candidate),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)),
  ]);
  return crypto.subtle.timingSafeEqual(candidateDigest, secretDigest);
}

// A signed-in browser sends the credential with every request to the
// dashboard, including one that a page on another site starts. Reads are safe
// (the other site cannot see the answer), but a write from another site is
// refused, so a page elsewhere cannot use the operator's sign-in to queue or
// retry archives.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function crossSiteWriteRefused(): Response {
  return new Response('Cross-site request refused.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// True when a browser says the request comes from another site. A client that
// is not a browser sends neither header, and a cross-site attack needs a browser.
function isCrossSite(request: Request): boolean {
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite) return fetchSite !== 'same-origin' && fetchSite !== 'none';
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true; // An opaque origin ("null") is never the dashboard itself.
  }
}

type Refusal = 'not_configured' | 'bad_credential' | 'cross_site_write' | 'too_many_guesses';

// Wrong credentials allowed per client address in one window before the
// dashboard stops checking that address's guesses for the rest of the window.
// The count lives in the Worker instance: it slows online guessing at the
// edge, it is not a global lockout.
const GUESS_LIMIT = 10;
const GUESS_WINDOW_MS = 60_000;
const guesses = new Map<string, { count: number; windowStart: number }>();

// The client address Cloudflare stamps on each request; a request without one
// (a local test client) is not counted.
function clientAddress(request: Request): string | undefined {
  return request.headers.get('CF-Connecting-IP') ?? undefined;
}

function guessesExhausted(address: string, now: number): boolean {
  const entry = guesses.get(address);
  return entry !== undefined && now - entry.windowStart < GUESS_WINDOW_MS && entry.count >= GUESS_LIMIT;
}

function countGuess(address: string, now: number): void {
  const entry = guesses.get(address);
  if (!entry || now - entry.windowStart >= GUESS_WINDOW_MS) {
    // Drop stale windows now and then, so the map stays small.
    if (guesses.size > 1000) {
      for (const [key, value] of guesses) if (now - value.windowStart >= GUESS_WINDOW_MS) guesses.delete(key);
    }
    guesses.set(address, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

/** Test hook: forget every counted guess. */
export function resetGuessCounts(): void {
  guesses.clear();
}

function tooManyGuesses(): Response {
  return new Response('Too many sign-in attempts. Try again in a minute.', {
    status: 429,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(GUESS_WINDOW_MS / 1000) },
  });
}

// One structured line per refused request, never with the credential, so a
// mis-set secret and repeated guesses show in the Worker's logs.
function logRefusal(request: Request, reason: Refusal): void {
  const line = {
    event: 'dashboard.auth.refused',
    reason,
    method: request.method,
    path: new URL(request.url).pathname,
    secFetchSite: request.headers.get('Sec-Fetch-Site'),
  };
  // A missing secret locks every operator out: a deploy defect, not a caller error.
  if (reason === 'not_configured') console.error(line);
  else console.warn(line);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const secret = context.env.DASHBOARD_AUTH;
  if (!secret) {
    logRefusal(request, 'not_configured');
    return authNotConfigured();
  }
  const candidate = credentialBytes(request.headers.get('Authorization'));
  const address = clientAddress(request);
  const now = Date.now();
  if (candidate && address && guessesExhausted(address, now)) {
    logRefusal(request, 'too_many_guesses');
    return tooManyGuesses();
  }
  if (!candidate || !(await matchesSecret(candidate, secret))) {
    // A browser's first request carries no credential; only a wrong one is a guess.
    if (candidate) {
      logRefusal(request, 'bad_credential');
      if (address) countGuess(address, now);
    }
    return signInRequired();
  }
  if (!READ_METHODS.has(request.method.toUpperCase()) && isCrossSite(request)) {
    logRefusal(request, 'cross_site_write');
    return crossSiteWriteRefused();
  }
  return context.next();
};
