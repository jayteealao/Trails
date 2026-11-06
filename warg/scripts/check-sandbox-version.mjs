// Checks that the monolith container image and the sandbox SDK name one version.
//
// The Dockerfile tag and the @cloudflare/sandbox dependency move by hand, in
// two files, and the worker only finds a difference at run time: an image left
// behind the SDK has already failed every monolith archive. This script reads
// both files and exits 1 unless the SDK is an exact version equal to the image
// tag. A range is refused too, because it lets the SDK move on its own.
//
// It uses only node: built-ins, so it runs in the deploy harness, which has no
// node_modules.
//
//   node scripts/check-sandbox-version.mjs [workerDir]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WARG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_PACKAGE = '@cloudflare/sandbox';
const IMAGE_LINE =
  /^\s*FROM\s+(?:--\S+\s+)*(?:docker\.io\/)?cloudflare\/sandbox:(\S+)(?:\s+AS\s+\S+)?\s*$/i;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

// The tag of the first cloudflare/sandbox FROM line, or undefined.
export function imageVersion(dockerfileText) {
  for (const line of dockerfileText.split(/\r?\n/)) {
    const match = IMAGE_LINE.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

export function sdkVersion(packageJson) {
  return packageJson.dependencies?.[SDK_PACKAGE];
}

// Returns one problem string per failure; each names both values.
export function compareVersions(image, sdk) {
  const both = `image ${image ?? '(none)'}, SDK ${sdk ?? '(none)'}`;
  if (image === undefined || sdk === undefined) {
    return [`sandbox version not found: ${both}`];
  }
  if (!EXACT_VERSION.test(sdk)) return [`sandbox SDK is not an exact version: ${both}`];
  if (image !== sdk) return [`sandbox versions differ: ${both}`];
  return [];
}

export function checkSandboxVersion(workerDir) {
  let image;
  let sdk;
  try {
    image = imageVersion(readFileSync(join(workerDir, 'Dockerfile'), 'utf8'));
    sdk = sdkVersion(JSON.parse(readFileSync(join(workerDir, 'package.json'), 'utf8')));
  } catch (err) {
    return { image, sdk, problems: [`cannot read the sandbox versions: ${err.message}`] };
  }
  return { image, sdk, problems: compareVersions(image, sdk) };
}

function main() {
  const workerDir = resolve(process.argv[2] ?? join(WARG, 'workers', 'monolith'));
  const { image, sdk, problems } = checkSandboxVersion(workerDir);
  if (problems.length === 0) {
    console.log(`ok   sandbox image ${image}, SDK ${sdk}`);
    return;
  }
  for (const problem of problems) console.log(`FAIL ${problem}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
