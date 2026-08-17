import type {
  CloudService,
  DeployActionInput,
  DeploymentRecord,
  OrganizationSettings,
} from './types';

export const initialServices: CloudService[] = [
  {
    id: 'auth-vault',
    name: 'Auth Vault & KMS',
    description: 'OAuth2/OIDC provider and cryptographic key management cluster',
    tier: 'core',
    region: 'us-east-1 (N. Virginia)',
    version: 'v2.14.0',
    replicas: 4,
    status: 'healthy',
    uptime: '99.99%',
    logs: [
      { id: 'l1', level: 'info', message: 'Token rotation cycle completed for tenant apex-prod', timestamp: '15:42:15' },
      { id: 'l2', level: 'info', message: 'JWKS endpoint synchronized with 12 edge nodes', timestamp: '15:41:00' },
      { id: 'l3', level: 'warn', message: 'Elevated rate of token refreshes from client sdk (50 req/s)', timestamp: '15:38:22' },
    ],
    metrics: [
      { timestamp: '15:40', cpuPercent: 24, memoryMb: 1024, rps: 840, latencyMs: 12 },
      { timestamp: '15:41', cpuPercent: 28, memoryMb: 1060, rps: 920, latencyMs: 14 },
      { timestamp: '15:42', cpuPercent: 22, memoryMb: 1012, rps: 810, latencyMs: 11 },
    ],
  },
  {
    id: 'edge-gateway',
    name: 'Edge API Gateway',
    description: 'High-throughput Envoy ingress proxy with global Anycast routing',
    tier: 'edge',
    region: 'global-anycast (24 PoPs)',
    version: 'v3.8.2',
    replicas: 16,
    status: 'healthy',
    uptime: '99.995%',
    logs: [
      { id: 'l4', level: 'info', message: 'WAF ruleset v4.2 applied across all Anycast PoPs', timestamp: '15:42:01' },
      { id: 'l5', level: 'info', message: 'TLS session cache hit ratio at 98.4%', timestamp: '15:39:10' },
    ],
    metrics: [
      { timestamp: '15:40', cpuPercent: 42, memoryMb: 4096, rps: 18400, latencyMs: 4 },
      { timestamp: '15:41', cpuPercent: 45, memoryMb: 4120, rps: 19200, latencyMs: 5 },
      { timestamp: '15:42', cpuPercent: 39, memoryMb: 4010, rps: 17800, latencyMs: 4 },
    ],
  },
  {
    id: 'realtime-pubsub',
    name: 'Realtime Pub/Sub Engine',
    description: 'Ultra-low latency WebSocket broker for live events and collaboration',
    tier: 'core',
    region: 'us-east-1 (N. Virginia)',
    version: 'v1.19.1',
    replicas: 6,
    status: 'degraded',
    uptime: '99.91%',
    logs: [
      { id: 'l6', level: 'warn', message: 'Channel backlog on queue: team-events-shard-3 exceeding 1,200 msgs', timestamp: '15:42:10' },
      { id: 'l7', level: 'error', message: 'Connection timeout with replica us-east-1c, triggering automatic failover', timestamp: '15:41:45' },
      { id: 'l8', level: 'info', message: 'Promoted node pubsub-c-4 to shard leader', timestamp: '15:41:50' },
    ],
    metrics: [
      { timestamp: '15:40', cpuPercent: 78, memoryMb: 8192, rps: 34000, latencyMs: 48 },
      { timestamp: '15:41', cpuPercent: 86, memoryMb: 8400, rps: 36200, latencyMs: 92 },
      { timestamp: '15:42', cpuPercent: 64, memoryMb: 7900, rps: 31000, latencyMs: 32 },
    ],
  },
  {
    id: 'analytics-worker',
    name: 'Telemetry & Analytics Worker',
    description: 'Background stream processing engine for metric rollups and logs ingestion',
    tier: 'data',
    region: 'us-west-2 (Oregon)',
    version: 'v4.0.5',
    replicas: 8,
    status: 'healthy',
    uptime: '99.98%',
    logs: [
      { id: 'l9', level: 'info', message: 'Aggregated 1.4B metrics for hour 15:00 UTC', timestamp: '15:40:00' },
      { id: 'l10', level: 'info', message: 'Flushed columnar segment to cloud storage bucket', timestamp: '15:35:12' },
    ],
    metrics: [
      { timestamp: '15:40', cpuPercent: 55, memoryMb: 6144, rps: 4200, latencyMs: 18 },
      { timestamp: '15:41', cpuPercent: 58, memoryMb: 6200, rps: 4400, latencyMs: 19 },
      { timestamp: '15:42', cpuPercent: 52, memoryMb: 6100, rps: 4100, latencyMs: 17 },
    ],
  },
  {
    id: 'blob-storage',
    name: 'Distributed Blob Store',
    description: 'S3-compatible immutable object store with automated cross-region replication',
    tier: 'data',
    region: 'eu-central-1 (Frankfurt)',
    version: 'v2.6.0',
    replicas: 12,
    status: 'healthy',
    uptime: '99.999%',
    logs: [
      { id: 'l11', level: 'info', message: 'Read/Write chunk parity check completed with 0 errors', timestamp: '15:30:00' },
      { id: 'l12', level: 'info', message: 'Replication sync with secondary region completed in 240ms', timestamp: '15:28:10' },
    ],
    metrics: [
      { timestamp: '15:40', cpuPercent: 18, memoryMb: 16384, rps: 6800, latencyMs: 8 },
      { timestamp: '15:41', cpuPercent: 20, memoryMb: 16400, rps: 7100, latencyMs: 8 },
      { timestamp: '15:42', cpuPercent: 19, memoryMb: 16350, rps: 6900, latencyMs: 7 },
    ],
  },
];

export const initialDeployments: DeploymentRecord[] = [
  {
    id: 'dep-901',
    serviceId: 'edge-gateway',
    serviceName: 'Edge API Gateway',
    version: 'v3.8.2',
    commitSha: '8f92a10',
    author: 'Sarah Chen (DevOps)',
    timestamp: '15:20 UTC',
    status: 'success',
    duration: '42s',
  },
  {
    id: 'dep-900',
    serviceId: 'auth-vault',
    serviceName: 'Auth Vault & KMS',
    version: 'v2.14.0',
    commitSha: 'c419b7e',
    author: 'Marcus Vance (Security)',
    timestamp: '14:45 UTC',
    status: 'success',
    duration: '1m 15s',
  },
  {
    id: 'dep-899',
    serviceId: 'realtime-pubsub',
    serviceName: 'Realtime Pub/Sub Engine',
    version: 'v1.19.1',
    commitSha: 'b771e42',
    author: 'Alex Rivera (Platform)',
    timestamp: '13:10 UTC',
    status: 'failed',
    duration: '2m 04s',
  },
  {
    id: 'dep-898',
    serviceId: 'analytics-worker',
    serviceName: 'Telemetry Worker',
    version: 'v4.0.5',
    commitSha: '110e5f2',
    author: 'Elena Rostova (Data)',
    timestamp: '11:05 UTC',
    status: 'success',
    duration: '58s',
  },
];

export const initialOrgSettings: OrganizationSettings = {
  orgName: 'Apex Cloud Technologies',
  clusterRegion: 'us-east-1 (N. Virginia)',
  maxReplicas: 64,
  autoScaling: true,
  billingTier: 'Enterprise Dedicated Platinum',
  contactEmail: 'platform-ops@apexcloud.io',
};

// In-memory mock database store
let servicesDb = [...initialServices];
let deploymentsDb = [...initialDeployments];
let orgSettingsDb = { ...initialOrgSettings };

export function getServiceById(id: string): CloudService | undefined {
  return servicesDb.find((s) => s.id === id);
}

export function getAllServices(): CloudService[] {
  return [...servicesDb];
}

export function getAllDeployments(): DeploymentRecord[] {
  return [...deploymentsDb];
}

export function getOrgSettings(): OrganizationSettings {
  return { ...orgSettingsDb };
}

export async function mockRouterFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(urlStr, 'http://localhost');
  const path = parsed.pathname;

  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 80));

  if (path === '/api/services' && (!init?.method || init.method === 'GET')) {
    return new Response(JSON.stringify(servicesDb), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (path === '/api/deploy' && init?.method === 'POST') {
    const body = JSON.parse(init.body as string) as DeployActionInput;
    const index = servicesDb.findIndex((s) => s.id === body.serviceId);
    if (index === -1) {
      return new Response(JSON.stringify({ error: 'Service not found' }), { status: 404 });
    }

    const current = servicesDb[index]!;
    const updated: CloudService = {
      ...current,
      version: body.targetVersion,
      status: 'healthy',
      logs: [
        {
          id: `l-${Date.now()}`,
          level: 'info',
          message: `Zero-downtime rolling update to ${body.targetVersion} deployed successfully across ${current.replicas} pods.`,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...current.logs,
      ],
    };
    servicesDb[index] = updated;

    deploymentsDb = [
      {
        id: `dep-${Date.now().toString().slice(-4)}`,
        serviceId: current.id,
        serviceName: current.name,
        version: body.targetVersion,
        commitSha: Math.random().toString(16).slice(2, 9),
        author: 'Current User (Console)',
        timestamp: 'Just now',
        status: 'success',
        duration: '18s',
      },
      ...deploymentsDb,
    ];

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (path === '/api/scale' && init?.method === 'POST') {
    const body = JSON.parse(init.body as string) as { serviceId: string; replicas: number };
    const index = servicesDb.findIndex((s) => s.id === body.serviceId);
    if (index !== -1) {
      servicesDb[index] = {
        ...servicesDb[index]!,
        replicas: body.replicas,
      };
      return new Response(JSON.stringify(servicesDb[index]), { status: 200 });
    }
  }

  return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
