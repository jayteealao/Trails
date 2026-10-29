// Second-account check for the live project: an account that does not own a
// shared article cannot claim it.
//
// It signs up a throwaway anonymous account, creates that account's own user
// article whose id equals the first account's shared id (the rules allow this;
// the article has no URL, so the save trigger links nothing), and then checks:
//   marker-write-refused   writing users/<anon>/articleMarkers/<sharedId> -> 403
//   shared-read-refused    reading articles/<sharedId>                   -> 403
//   signed-link-refused    GET <signed-url-base>/app/signed-url for it   -> non-2xx, no url
// It then deletes its article and the anonymous account, prints one
// `PASS|FAIL <check> (<status>)` line per check and exits 1 on any FAIL.
// It never prints the token, the anonymous uid or the key.
//
//   FIREBASE_WEB_API_KEY=<web key> node scripts/second-account-check.mjs \
//     --project <project id> --shared-id <shared id> --signed-url-base <dashboard-api URL>
import { pathToFileURL } from 'node:url';

const USAGE =
  'usage: FIREBASE_WEB_API_KEY=<web key> node scripts/second-account-check.mjs --project <id> --shared-id <id> --signed-url-base <url>';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';

/**
 * Runs the check. `fetchImpl` and `log` are injectable for the self-test.
 * Returns the process exit code: 0 when every check passed, 1 otherwise.
 */
export async function runSecondAccountCheck({ fetchImpl = fetch, apiKey, projectId, sharedId, signedUrlBase, log = console.log }) {
  const docs = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const keyQuery = `key=${encodeURIComponent(apiKey)}`;
  const results = [];
  const record = (check, pass, status) => {
    results.push(pass);
    log(`${pass ? 'PASS' : 'FAIL'} ${check} (${status})`);
  };
  const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const signUp = await fetchImpl(`${IDENTITY}/accounts:signUp?${keyQuery}`, json({ returnSecureToken: true }));
  const account = signUp.ok ? await signUp.json() : null;
  if (!account?.idToken || !account?.localId) {
    record('anonymous-sign-up', false, signUp.status);
    return 1;
  }
  const { idToken, localId } = account;
  const auth = { authorization: `Bearer ${idToken}` };
  const articlePath = `${docs}/users/${encodeURIComponent(localId)}/articles`;

  try {
    const created = await fetchImpl(`${articlePath}?documentId=${encodeURIComponent(sharedId)}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { secondAccountCheck: { booleanValue: true } } }),
    });
    if (!created.ok) record('own-article-created', false, created.status);

    const marker = await fetchImpl(
      `${docs}/users/${encodeURIComponent(localId)}/articleMarkers?documentId=${encodeURIComponent(sharedId)}`,
      {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          fields: {
            key: { stringValue: sharedId },
            itemId: { stringValue: sharedId },
            source: { stringValue: 'sync' },
          },
        }),
      }
    );
    record('marker-write-refused', marker.status === 403, marker.status);

    const read = await fetchImpl(`${docs}/articles/${encodeURIComponent(sharedId)}`, { headers: auth });
    record('shared-read-refused', read.status === 403, read.status);

    const base = signedUrlBase.replace(/\/+$/, '');
    const signed = await fetchImpl(
      `${base}/app/signed-url?itemId=${encodeURIComponent(sharedId)}&archiveKey=readability`,
      { headers: auth }
    );
    let body = null;
    try {
      body = await signed.json();
    } catch {
      body = null;
    }
    const gotLink = signed.ok && typeof body?.url === 'string';
    record('signed-link-refused', !gotLink, signed.status);
  } finally {
    const cleanup = [
      () => fetchImpl(`${articlePath}/${encodeURIComponent(sharedId)}`, { method: 'DELETE', headers: auth }),
      () => fetchImpl(`${IDENTITY}/accounts:delete?${keyQuery}`, json({ idToken })),
    ];
    for (const step of cleanup) {
      try {
        const res = await step();
        if (!res.ok) log(`WARN cleanup step answered ${res.status}`);
      } catch {
        log('WARN cleanup step failed');
      }
    }
  }

  return results.every(Boolean) ? 0 : 1;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = { '--project': 'projectId', '--shared-id': 'sharedId', '--signed-url-base': 'signedUrlBase' }[argv[i]];
    if (!name || argv[i + 1] === undefined) return null;
    out[name] = argv[i + 1];
    i += 1;
  }
  return out.projectId && out.sharedId && out.signedUrlBase ? out : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!args || !apiKey) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(await runSecondAccountCheck({ ...args, apiKey }));
}
