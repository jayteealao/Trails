// Checks the tracked tree for function keys held outside Secret Manager and
// for a committed user id.
//
// Rules:
//   key-param       a cloud-function source file declares a key, secret,
//                   token or password with defineString/defineInt/... instead
//                   of defineSecret
//   module-key-read a cloud-function source file reads such a value from
//                   process.env in a top-level declaration (secrets resolve
//                   only at run time, inside the handler)
//   uid-shape       any tracked text file holds a 28-character alphanumeric
//                   token with upper case, lower case and a digit (the shape
//                   of a Firebase Auth uid); a line that carries
//                   "uid-check: allow" is exempt
//
// A hit prints `path:line rule` with the token reduced to its shape, never the
// token itself, and the script exits 1.
//
//   node scripts/check-keys-and-uid.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const KEY_NAME = /(API_KEY|_KEY|SECRET|TOKEN|PASSWORD)$/;
const FUNCTION_SOURCE = /^warg\/cloud-functions\/[^/]+\/src\/.+\.ts$/;
const PARAM_DECL =
  /\bdefine(?:String|Int|Boolean|Float|List)\(\s*['"]([A-Za-z0-9_]+)['"]/g;
const TOP_LEVEL_ENV_READ =
  /^(?:export\s+)?(?:const|let|var)\b[^=]*=.*?\bprocess\.env(?:\.([A-Za-z0-9_]+)|\[\s*['"]([A-Za-z0-9_]+)['"]\s*\])/;
const UID_TOKEN = /(?<![A-Za-z0-9])[A-Za-z0-9]{28}(?![A-Za-z0-9])/g;
const ALLOW = 'uid-check: allow';

const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|[^/]*\.lock)$/;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|svgz|pdf|zip|gz|tgz|jar|aar|apk|aab|keystore|jks|p12|so|dll|exe|bin|class|dex|woff2?|ttf|otf|eot|mp[34]|webm|mov|wasm)$/i;

export function isUidShape(token) {
  return /[A-Z]/.test(token) && /[a-z]/.test(token) && /[0-9]/.test(token);
}

export function redact(token) {
  return `<${token.length} alphanumeric>`;
}

// A token inside an unbroken run of at least BASE64_BLOB base64 characters is
// a slice of encoded data (a certificate, an inline image), not an id; a uid
// in a document path such as users/<uid>/articles/<id> sits in a far shorter
// run. The marker cannot go on such a line without changing the data.
export const BASE64_BLOB = 200;
const BASE64_CHAR = /[A-Za-z0-9+/=]/;

export function inBase64Blob(lineText, index, length) {
  let start = index;
  while (start > 0 && BASE64_CHAR.test(lineText[start - 1])) start--;
  let end = index + length;
  while (end < lineText.length && BASE64_CHAR.test(lineText[end])) end++;
  return end - start >= BASE64_BLOB;
}

export function skipForUid(path) {
  return LOCKFILE.test(path) || BINARY_EXT.test(path);
}

// entries: [{ path, text }] with repo-relative, forward-slash paths.
// Returns [{ path, line, rule, detail }]; detail never holds a uid token.
export function scan(entries) {
  const hits = [];
  for (const { path, text } of entries) {
    const lines = text.split(/\r?\n/);
    const isFunctionSource = FUNCTION_SOURCE.test(path);
    const checkUid = !skipForUid(path);
    lines.forEach((lineText, i) => {
      const line = i + 1;
      if (isFunctionSource) {
        for (const m of lineText.matchAll(PARAM_DECL)) {
          if (KEY_NAME.test(m[1])) {
            hits.push({ path, line, rule: 'key-param', detail: m[1] });
          }
        }
        const env = TOP_LEVEL_ENV_READ.exec(lineText);
        const envName = env && (env[1] ?? env[2]);
        if (envName && KEY_NAME.test(envName)) {
          hits.push({ path, line, rule: 'module-key-read', detail: envName });
        }
      }
      if (checkUid && !lineText.includes(ALLOW)) {
        for (const m of lineText.matchAll(UID_TOKEN)) {
          if (
            isUidShape(m[0]) &&
            !inBase64Blob(lineText, m.index, m[0].length)
          ) {
            hits.push({ path, line, rule: 'uid-shape', detail: redact(m[0]) });
          }
        }
      }
    });
  }
  return hits;
}

export function format(hit) {
  return `${hit.path}:${hit.line} ${hit.rule} ${hit.detail}`;
}

function trackedEntries(root) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  const entries = [];
  for (const path of out.split('\0')) {
    if (!path || BINARY_EXT.test(path)) continue;
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue;
    entries.push({ path, text: buf.toString('utf8') });
  }
  return entries;
}

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8'
  }).trim();
  const entries = trackedEntries(root);
  const hits = scan(entries);
  if (hits.length === 0) {
    console.log(
      `ok   ${entries.length} tracked files: no key parameter, no module-load key read, no uid-shaped token`
    );
    return;
  }
  for (const hit of hits) console.log(format(hit));
  console.log(
    `${hits.length} finding(s): move keys to defineSecret and read them in the handler; take user ids from deploy configuration or an argument`
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
