/// <reference types="node" />
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// --- The infra function builds its worker list from the config ---

const ACCOUNT_ID = 'test-account';

// One account answers every analytics query: traffic for gateway and for a
// script that is not a Warg worker, and empty storage groups.
const ACCOUNT_FIXTURE = {
  data: {
    viewer: {
      accounts: [
        {
          workersInvocationsAdaptive: [
            { dimensions: { scriptName: 'gateway' }, sum: { requests: 5, errors: 1 }, quantiles: { cpuTimeP50: 2, cpuTimeP99: 9 } },
            { dimensions: { scriptName: 'not-a-warg-worker' }, sum: { requests: 50, errors: 0 }, quantiles: { cpuTimeP50: 1, cpuTimeP99: 3 } },
          ],
          d1AnalyticsAdaptiveGroups: [],
          r2StorageAdaptiveGroups: [],
          durableObjectsStorageGroups: [],
          durableObjectsInvocationsAdaptiveGroups: [],
        },
      ],
    },
  },
};

interface InfraWorker {
  scriptName: string;
  requests: number;
  errors: number;
  cpuP50: number | null;
  cpuP99: number | null;
}

describe('infra worker list', () => {
  const fetched: string[] = [];

  beforeEach(() => {
    fetched.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      const body = (init?.method ?? 'GET') === 'POST' ? ACCOUNT_FIXTURE : { success: true, result: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getInfra(env: Record<string, string>): Promise<Response> {
    const { onRequestGet } = await import('../infra');
    // The function reads only `env`; the rest of the Pages context is unused here.
    const context = { env, request: new Request('https://dashboard.example.com/api/infra'), params: {} };
    return onRequestGet(context as unknown as Parameters<typeof onRequestGet>[0]);
  }

  async function workersOf(response: Response): Promise<InfraWorker[]> {
    const body: { workers: InfraWorker[] } = await response.json();
    return body.workers;
  }

  it('answers one row per configured worker, hyperrenderer included, and no other script', async () => {
    const response = await getInfra({ CF_API_TOKEN: 'token', CF_ACCOUNT_ID: ACCOUNT_ID });
    expect(response.status).toBe(200);
    const names = (await workersOf(response)).map((w) => w.scriptName).sort();
    expect(names).toEqual([...inventory.workers].sort());
    expect(names).toContain('hyperrenderer');
    expect(names).not.toContain('not-a-warg-worker');
  });

  it('answers a zero-traffic row for hyperrenderer', async () => {
    const workers = await workersOf(await getInfra({ CF_API_TOKEN: 'token', CF_ACCOUNT_ID: ACCOUNT_ID }));
    expect(workers.find((w) => w.scriptName === 'hyperrenderer')).toEqual({
      scriptName: 'hyperrenderer', requests: 0, errors: 0, cpuP50: null, cpuP99: null,
    });
  });

  it('calls the Cloudflare API when no base URL is set', async () => {
    await getInfra({ CF_API_TOKEN: 'token', CF_ACCOUNT_ID: ACCOUNT_ID });
    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) expect(url.startsWith('https://api.cloudflare.com/client/v4/')).toBe(true);
  });

  it('calls the base URL it is given', async () => {
    await getInfra({ CF_API_TOKEN: 'token', CF_ACCOUNT_ID: ACCOUNT_ID, CF_API_URL: 'http://127.0.0.1:9/client/v4' });
    expect(fetched).toContain('http://127.0.0.1:9/client/v4/graphql');
    expect(fetched).toContain(
      `http://127.0.0.1:9/client/v4/accounts/${ACCOUNT_ID}/workflows/archive-workflow/instances?per_page=100`,
    );
    for (const url of fetched) expect(url.startsWith('http://127.0.0.1:9/client/v4/')).toBe(true);
  });
});
