/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import inventory from '../../lib/workers.json';
import { inventoryDrift, workerDirNames } from './worker-inventory';

const WORKERS_DIR = fileURLToPath(new URL('../../../../../workers', import.meta.url));

describe('worker inventory drift', () => {
  it('lists exactly the workers of warg/workers, each named after its directory', () => {
    const drift = inventoryDrift(inventory.workers, WORKERS_DIR);
    expect(
      drift,
      `The dashboard worker list drifted from warg/workers (${JSON.stringify(drift)}). ` +
        'Edit warg/pages/dashboard/functions/lib/workers.json to list every worker directory, ' +
        "and keep each worker's wrangler.jsonc name equal to its directory name.",
    ).toEqual({ missing: [], extra: [], misnamed: [] });
  });

  describe('on a copy of the worker tree', () => {
    let root: string;

    const addWorker = (dir: string, text = JSON.stringify({ name: dir })) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, 'wrangler.jsonc'), text);
    };

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'warg-workers-'));
      for (const name of inventory.workers) addWorker(name);
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('agrees with the config before any change', () => {
      expect(inventoryDrift(inventory.workers, root)).toEqual({ missing: [], extra: [], misnamed: [] });
    });

    it('fails on a worker directory the config does not list', () => {
      addWorker('newworker');
      expect(inventoryDrift(inventory.workers, root)).toEqual({ missing: ['newworker'], extra: [], misnamed: [] });
    });

    it('fails on a listed worker whose directory is gone', () => {
      rmSync(join(root, 'hyperrenderer'), { recursive: true });
      expect(inventoryDrift(inventory.workers, root)).toEqual({ missing: [], extra: ['hyperrenderer'], misnamed: [] });
    });

    it('fails on a worker whose config name is not its directory name', () => {
      addWorker('renderer', JSON.stringify({ name: 'renderer-v2' }));
      expect(inventoryDrift(inventory.workers, root)).toEqual({ missing: [], extra: [], misnamed: ['renderer'] });
    });

    it('reads a config that opens with // comments', () => {
      addWorker('logger', '// Logger worker\n// keeps the request trace\n{\n  "name": "logger", // the script name\n}\n');
      expect(workerDirNames(root).find((w) => w.dir === 'logger')).toEqual({ dir: 'logger', name: 'logger' });
    });

    it('ignores a directory with no wrangler.jsonc', () => {
      mkdirSync(join(root, 'shared'));
      expect(inventoryDrift(inventory.workers, root)).toEqual({ missing: [], extra: [], misnamed: [] });
    });
  });
});
