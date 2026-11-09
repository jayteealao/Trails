/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every dashboard function route, read from the files on disk, so a route
// added later is checked by the sign-in tests without editing them.

export interface RouteFile {
  file: string;
  path: string;
  methods: string[];
}

const HANDLER_EXPORT = /export const onRequest(Get|Post|Put|Patch|Delete|Head|Options)?\b/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : routeFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.startsWith('_') ? [full] : [];
  });
}

export function listRoutes(apiDir: string): RouteFile[] {
  return routeFiles(apiDir)
    .map((file) => {
      const segments = relative(apiDir, file)
        .replace(/\.ts$/, '')
        .split(/[\\/]/)
        .map((segment) => segment.replace(/^\[(.+)\]$/, 'sample-$1'));
      if (segments[segments.length - 1] === 'index') segments.pop();
      const methods = new Set<string>();
      for (const [, method] of readFileSync(file, 'utf8').matchAll(HANDLER_EXPORT)) {
        if (method) methods.add(method.toUpperCase());
        else methods.add('GET').add('POST');
      }
      return { file, path: ['/api', ...segments].join('/'), methods: [...methods].sort() };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
