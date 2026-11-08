/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// The workers on disk, read from each worker's own wrangler config, so the
// dashboard's worker list can be checked against the real set of workers.

export interface WorkerDir {
  dir: string;
  name: string | undefined;
}

// Every directory of workersDir that holds a wrangler.jsonc, with the `name`
// of that config. The configs may carry `//` comments, so they are read with
// TypeScript's JSON-with-comments parser.
export function workerDirNames(workersDir: string): WorkerDir[] {
  return readdirSync(workersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(workersDir, entry.name, 'wrangler.jsonc')))
    .map((entry) => {
      const file = join(workersDir, entry.name, 'wrangler.jsonc');
      const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
      if (error) {
        throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
      }
      const parsed: unknown = config;
      const name = typeof parsed === 'object' && parsed !== null && 'name' in parsed ? parsed.name : undefined;
      return { dir: entry.name, name: typeof name === 'string' ? name : undefined };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

export interface InventoryDrift {
  missing: string[];
  extra: string[];
  misnamed: string[];
}

// missing: worker directories the config does not list; extra: config names
// with no worker directory; misnamed: directories whose config `name` is not
// the directory name (analytics and the deploy script key on the directory).
export function inventoryDrift(config: readonly string[], workersDir: string): InventoryDrift {
  const dirs = workerDirNames(workersDir);
  const dirSet = new Set(dirs.map((d) => d.dir));
  const listed = new Set(config);
  return {
    missing: dirs.filter((d) => !listed.has(d.dir)).map((d) => d.dir),
    extra: [...listed].filter((name) => !dirSet.has(name)).sort(),
    misnamed: dirs.filter((d) => d.name !== d.dir).map((d) => d.dir),
  };
}
