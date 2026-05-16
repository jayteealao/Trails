// Proxy for GET /api/infra -> Cloudflare GraphQL + Workflows REST APIs

interface Env {
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}

const CF_GQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

const WORKER_NAMES = [
  'gateway', 'logger', 'workflow', 'renderer',
  'singlefile', 'readability', 'monolith', 'gcs',
];

const WORKFLOW_NAME = 'archive-workflow';
const D1_DATABASE_ID = 'ff077e87-293b-4434-ad9e-ab669c9cbabb';
const R2_BUCKET_NAME = 'warg-archives';

function iso24hAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function isoNow(): string {
  return new Date().toISOString();
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface GqlResponse {
  data?: {
    viewer?: {
      accounts?: Array<Record<string, unknown>>;
    };
  };
  errors?: Array<{ message: string }>;
}

async function queryGraphQL(token: string, query: string, variables: Record<string, unknown>): Promise<GqlResponse> {
  const res = await fetch(CF_GQL_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status}`);
  }

  return res.json() as Promise<GqlResponse>;
}

interface WorkerMetric {
  scriptName: string;
  requests: number;
  errors: number;
  cpuP50: number | null;
  cpuP99: number | null;
}

interface WorkerRow {
  dimensions: { scriptName: string };
  sum: { requests: number; errors: number };
  quantiles: { cpuTimeP50: number; cpuTimeP99: number };
}

async function fetchWorkerMetrics(token: string, accountId: string): Promise<WorkerMetric[]> {
  const query = `query WorkersMetrics($accountTag: string!, $datetimeStart: Time!, $datetimeEnd: Time!) {
    viewer {
      accounts(filter: {accountTag: $accountTag}) {
        workersInvocationsAdaptive(
          limit: 100
          filter: {
            datetime_geq: $datetimeStart
            datetime_leq: $datetimeEnd
          }
          orderBy: [sum_requests_DESC]
        ) {
          dimensions {
            scriptName
          }
          sum {
            requests
            errors
          }
          quantiles {
            cpuTimeP50
            cpuTimeP99
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(token, query, {
    accountTag: accountId,
    datetimeStart: iso24hAgo(),
    datetimeEnd: isoNow(),
  });

  const account = data.data?.viewer?.accounts?.[0];
  if (!account) return [];

  const rows = (account.workersInvocationsAdaptive ?? []) as WorkerRow[];

  // Aggregate by scriptName (rows may be per-status)
  const byScript = new Map<string, WorkerMetric>();
  for (const row of rows) {
    const name = row.dimensions.scriptName;
    if (!WORKER_NAMES.includes(name)) continue;

    const existing = byScript.get(name);
    if (existing) {
      existing.requests += row.sum.requests;
      existing.errors += row.sum.errors;
      // Keep the latest quantiles (they're aggregated across the period anyway)
      if (row.quantiles.cpuTimeP50) existing.cpuP50 = row.quantiles.cpuTimeP50;
      if (row.quantiles.cpuTimeP99) existing.cpuP99 = row.quantiles.cpuTimeP99;
    } else {
      byScript.set(name, {
        scriptName: name,
        requests: row.sum.requests,
        errors: row.sum.errors,
        cpuP50: row.quantiles.cpuTimeP50 ?? null,
        cpuP99: row.quantiles.cpuTimeP99 ?? null,
      });
    }
  }

  // Include workers that had zero traffic
  for (const name of WORKER_NAMES) {
    if (!byScript.has(name)) {
      byScript.set(name, { scriptName: name, requests: 0, errors: 0, cpuP50: null, cpuP99: null });
    }
  }

  return Array.from(byScript.values()).sort((a, b) => b.requests - a.requests);
}

interface D1Metrics {
  queryCount: number;
  rowsRead: number;
  rowsWritten: number;
  databaseSize: number | null;
}

interface D1Row {
  sum: { readQueries: number; writeQueries: number; rowsRead: number; rowsWritten: number };
}

async function fetchD1Metrics(token: string, accountId: string): Promise<D1Metrics> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const query = `query D1Metrics($accountTag: string!, $databaseId: string!, $dateStart: Date!, $dateEnd: Date!) {
    viewer {
      accounts(filter: {accountTag: $accountTag}) {
        d1AnalyticsAdaptiveGroups(
          limit: 1000
          filter: {
            date_geq: $dateStart
            date_leq: $dateEnd
            databaseId: $databaseId
          }
        ) {
          sum {
            readQueries
            writeQueries
            rowsRead
            rowsWritten
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(token, query, {
    accountTag: accountId,
    databaseId: D1_DATABASE_ID,
    dateStart: dateStr(yesterday),
    dateEnd: dateStr(now),
  });

  const account = data.data?.viewer?.accounts?.[0];
  if (!account) {
    return { queryCount: 0, rowsRead: 0, rowsWritten: 0, databaseSize: null };
  }

  const rows = (account.d1AnalyticsAdaptiveGroups ?? []) as D1Row[];

  let totalQueries = 0;
  let totalRowsRead = 0;
  let totalRowsWritten = 0;

  for (const row of rows) {
    totalQueries += (row.sum.readQueries ?? 0) + (row.sum.writeQueries ?? 0);
    totalRowsRead += row.sum.rowsRead ?? 0;
    totalRowsWritten += row.sum.rowsWritten ?? 0;
  }

  return {
    queryCount: totalQueries,
    rowsRead: totalRowsRead,
    rowsWritten: totalRowsWritten,
    databaseSize: null, // D1 doesn't expose size via GraphQL; could use REST API later
  };
}

interface R2Metrics {
  bucketSize: number | null;
  objectCount: number | null;
  operationCount: number;
}

interface R2Row {
  max: { objectCount: number; payloadSize: number };
}

async function fetchR2Metrics(token: string, accountId: string): Promise<R2Metrics> {
  const query = `query R2Metrics($accountTag: string!, $bucketName: string!, $datetimeStart: Time!, $datetimeEnd: Time!) {
    viewer {
      accounts(filter: {accountTag: $accountTag}) {
        r2StorageAdaptiveGroups(
          limit: 100
          filter: {
            datetime_geq: $datetimeStart
            datetime_leq: $datetimeEnd
            bucketName: $bucketName
          }
          orderBy: [datetime_DESC]
        ) {
          max {
            objectCount
            payloadSize
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(token, query, {
    accountTag: accountId,
    bucketName: R2_BUCKET_NAME,
    datetimeStart: iso24hAgo(),
    datetimeEnd: isoNow(),
  });

  const account = data.data?.viewer?.accounts?.[0];
  if (!account) {
    return { bucketSize: null, objectCount: null, operationCount: 0 };
  }

  const rows = (account.r2StorageAdaptiveGroups ?? []) as R2Row[];

  // Take the most recent max values
  let maxPayload = 0;
  let maxObjects = 0;

  for (const row of rows) {
    if (row.max.payloadSize > maxPayload) maxPayload = row.max.payloadSize;
    if (row.max.objectCount > maxObjects) maxObjects = row.max.objectCount;
  }

  return {
    bucketSize: maxPayload || null,
    objectCount: maxObjects || null,
    operationCount: rows.length, // approximate ops from data points
  };
}

interface DOMetrics {
  storageBytes: number | null;
  requestCount: number;
}

interface DOStorageRow {
  max: { storedBytes: number };
}

interface DOInvocationsRow {
  sum: { requests: number };
}

async function fetchDOMetrics(token: string, accountId: string): Promise<DOMetrics> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const query = `query DOMetrics($accountTag: string!, $dateStart: Date!) {
    viewer {
      accounts(filter: {accountTag: $accountTag}) {
        durableObjectsStorageGroups(
          filter: {date_gt: $dateStart}
          limit: 100
        ) {
          max {
            storedBytes
          }
        }
        durableObjectsInvocationsAdaptiveGroups(
          filter: {date_gt: $dateStart}
          limit: 100
        ) {
          sum {
            requests
          }
        }
      }
    }
  }`;

  const data = await queryGraphQL(token, query, {
    accountTag: accountId,
    dateStart: dateStr(yesterday),
  });

  const account = data.data?.viewer?.accounts?.[0];
  if (!account) {
    return { storageBytes: null, requestCount: 0 };
  }

  const storageRows = (account.durableObjectsStorageGroups ?? []) as DOStorageRow[];
  const invocationRows = (account.durableObjectsInvocationsAdaptiveGroups ?? []) as DOInvocationsRow[];

  let maxStorage = 0;
  for (const row of storageRows) {
    if (row.max.storedBytes > maxStorage) maxStorage = row.max.storedBytes;
  }

  let totalRequests = 0;
  for (const row of invocationRows) {
    totalRequests += row.sum.requests ?? 0;
  }

  return {
    storageBytes: maxStorage || null,
    requestCount: totalRequests,
  };
}

interface WorkflowInstance {
  id: string;
  status: string;
  created_on: string;
}

interface WorkflowsResult {
  statusCounts: Record<string, number>;
}

interface WorkflowsApiResponse {
  success: boolean;
  result?: WorkflowInstance[];
}

async function fetchWorkflowMetrics(token: string, accountId: string): Promise<WorkflowsResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workflows/${WORKFLOW_NAME}/instances?per_page=100`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    // Workflow might not exist yet or no instances
    return { statusCounts: {} };
  }

  const data = await res.json() as WorkflowsApiResponse;
  if (!data.success || !data.result) {
    return { statusCounts: {} };
  }

  const counts: Record<string, number> = {};
  for (const instance of data.result) {
    counts[instance.status] = (counts[instance.status] ?? 0) + 1;
  }

  return { statusCounts: counts };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;

  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return new Response(
      JSON.stringify({ error: 'CF_API_TOKEN and CF_ACCOUNT_ID secrets are required' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Fetch all metrics in parallel
    const [workers, d1, r2, durableObjects, workflows] = await Promise.all([
      fetchWorkerMetrics(env.CF_API_TOKEN, env.CF_ACCOUNT_ID),
      fetchD1Metrics(env.CF_API_TOKEN, env.CF_ACCOUNT_ID),
      fetchR2Metrics(env.CF_API_TOKEN, env.CF_ACCOUNT_ID),
      fetchDOMetrics(env.CF_API_TOKEN, env.CF_ACCOUNT_ID),
      fetchWorkflowMetrics(env.CF_API_TOKEN, env.CF_ACCOUNT_ID),
    ]);

    return new Response(JSON.stringify({
      workers,
      d1,
      r2,
      durableObjects,
      workflows,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
