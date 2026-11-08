// Every dashboard page and API call needs the dashboard credential. The
// browser's own sign-in prompt asks for it (HTTP Basic) and then sends it
// with every later request.

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

export const onRequest: PagesFunction<Env> = async (context) => {
  const secret = context.env.DASHBOARD_AUTH;
  if (!secret) return signInRequired();
  const candidate = credentialBytes(context.request.headers.get('Authorization'));
  if (!candidate || !(await matchesSecret(candidate, secret))) return signInRequired();
  return context.next();
};
