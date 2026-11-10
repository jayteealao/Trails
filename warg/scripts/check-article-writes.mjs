// Checks the cloud-function sources for Firestore document writes made
// outside the article writer module (@warg/article-writer).
//
// Rule:
//   article-write  a cloud-function source file calls set, update, create or
//                  delete on a DocumentReference, Transaction, WriteBatch or
//                  BulkWriter, or add on a CollectionReference, of
//                  @google-cloud/firestore. The TypeScript checker resolves
//                  each call to its declaring class, so Map.set and Set.add
//                  never match, and an aliased reference or a call split over
//                  two lines still does.
//
// Every such write counts as an article write: the articles document is
// written only through the writer module, which lives outside the scanned
// tree. A write to another document (a tracker, a marker) is exempt when its
// own line, or a comment-only line just above it, carries
//
//   // article-write-check: not-an-article (<what the document is>)
//
// Tests (__tests__/ and *.test.ts) are not scanned. A function folder without
// a tsconfig.json is a configuration error (exit 2), so a new function is
// either scanned or the check fails.
//
// A hit prints `path:line article-write <Owner>.<method>` with the line of the
// method name, and the script exits 1.
//
//   node scripts/check-article-writes.mjs                 scan every function
//   node scripts/check-article-writes.mjs --files a.ts …  scan the given files
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WARG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(WARG, '..');
const ts = createRequire(join(WARG, 'package.json'))('typescript');

const MARKER = 'article-write-check: not-an-article';
const WRITE_METHODS = {
  DocumentReference: ['set', 'update', 'create', 'delete'],
  Transaction: ['set', 'update', 'create', 'delete'],
  WriteBatch: ['set', 'update', 'create', 'delete'],
  BulkWriter: ['set', 'update', 'create', 'delete'],
  CollectionReference: ['add']
};
const ANY_METHOD = new Set(Object.values(WRITE_METHODS).flat());
const FIRESTORE_TYPES = /[\\/]@google-cloud[\\/]firestore[\\/]/;
const FUNCTION_SOURCE = /^warg\/cloud-functions\/[^/]+\/src\/.+\.ts$/;

export const FILES_OPTIONS = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  skipLibCheck: true,
  noEmit: true
};

const repoPath = (abs) => relative(REPO, abs).replace(/\\/g, '/');

// path: repo-relative with forward slashes.
export function isScannedSource(path) {
  return (
    FUNCTION_SOURCE.test(path) &&
    !path.includes('/__tests__/') &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.d.ts')
  );
}

// The class that declares the called method, when it is a Firestore write.
function firestoreWriteOwner(checker, call, method) {
  const decl =
    checker.getResolvedSignature(call)?.declaration ??
    checker.getSymbolAtLocation(call.expression.name)?.declarations?.[0];
  if (!decl || !FIRESTORE_TYPES.test(decl.getSourceFile().fileName)) return null;
  const owner = decl.parent?.name?.text;
  return WRITE_METHODS[owner]?.includes(method) ? owner : null;
}

// The marker on the write's own line, or on a comment-only line just above.
// A trailing marker on the line above belongs to that line's write, so it
// does not exempt the next one.
function exempt(sourceFile, line) {
  const lines = sourceFile.text.split(/\r?\n/);
  const own = lines[line - 1] ?? '';
  const above = (lines[line - 2] ?? '').trim();
  return own.includes(MARKER) || (above.startsWith('//') && above.includes(MARKER));
}

// isScanned: (repo-relative path) => boolean.
// Returns [{ path, line, owner, method }] in source order.
export function scanProgram(program, isScanned) {
  const checker = program.getTypeChecker();
  const hits = [];
  for (const sourceFile of program.getSourceFiles()) {
    const path = repoPath(sourceFile.fileName);
    if (sourceFile.isDeclarationFile || !isScanned(path)) continue;
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ANY_METHOD.has(node.expression.name.text)
      ) {
        const method = node.expression.name.text;
        const owner = firestoreWriteOwner(checker, node, method);
        const line =
          sourceFile.getLineAndCharacterOfPosition(
            node.expression.name.getStart(sourceFile)
          ).line + 1;
        if (owner && !exempt(sourceFile, line)) {
          hits.push({ path, line, owner, method });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return hits;
}

export function format(hit) {
  return `${hit.path}:${hit.line} article-write ${hit.owner}.${hit.method}`;
}

function sourceFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((p) => join(dir, String(p)))
    .filter((abs) => isScannedSource(repoPath(abs)));
}

function packageProgram(pkgDir) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(pkgDir, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  );
  if (!parsed) throw new Error(`${repoPath(pkgDir)}/tsconfig.json: unreadable`);
  // Every source file is a root, so a file the tsconfig leaves out is scanned.
  const roots = new Set([
    ...parsed.fileNames.map((f) => resolve(f)),
    ...sourceFiles(join(pkgDir, 'src'))
  ]);
  return ts.createProgram([...roots], { ...parsed.options, noEmit: true });
}

export function main(argv) {
  let hits;
  let scanned;
  if (argv[0] === '--files') {
    const files = argv.slice(1).map((f) => resolve(f));
    if (files.length === 0) {
      console.error('usage: check-article-writes.mjs [--files <a.ts> …]');
      return 2;
    }
    const given = new Set(files.map(repoPath));
    hits = scanProgram(ts.createProgram(files, FILES_OPTIONS), (p) =>
      given.has(p)
    );
    scanned = `${files.length} file(s)`;
  } else {
    const root = join(WARG, 'cloud-functions');
    const pkgs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const missing = pkgs.filter((p) => !existsSync(join(root, p, 'tsconfig.json')));
    if (missing.length > 0) {
      for (const p of missing) {
        console.error(
          `warg/cloud-functions/${p}: no tsconfig.json, so its sources cannot be scanned for article writes`
        );
      }
      return 2;
    }
    hits = pkgs.flatMap((p) => scanProgram(packageProgram(join(root, p)), isScannedSource));
    scanned = `${pkgs.length} packages (${pkgs.join(', ')})`;
  }
  if (hits.length === 0) {
    console.log(`ok   ${scanned}: no Firestore document write outside the writer module`);
    return 0;
  }
  for (const hit of hits) console.log(format(hit));
  console.log(
    `${hits.length} finding(s): write the articles document through @warg/article-writer; ` +
      `mark a write to another document with "// ${MARKER} (<what it is>)" on its line or the line above`
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
