export type ServiceStatus = 'healthy' | 'degraded' | 'deploying' | 'stopped';
export type ServiceTier = 'core' | 'edge' | 'data';

export interface ServiceMetric {
  readonly timestamp: string;
  readonly cpuPercent: number;
  readonly memoryMb: number;
  readonly rps: number;
  readonly latencyMs: number;
}

export interface ServiceLog {
  readonly id: string;
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly timestamp: string;
}

export interface CloudService {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tier: ServiceTier;
  readonly region: string;
  readonly version: string;
  readonly replicas: number;
  readonly status: ServiceStatus;
  readonly uptime: string;
  readonly logs: readonly ServiceLog[];
  readonly metrics: readonly ServiceMetric[];
}

export interface DeploymentRecord {
  readonly id: string;
  readonly serviceId: string;
  readonly serviceName: string;
  readonly version: string;
  readonly commitSha: string;
  readonly author: string;
  readonly timestamp: string;
  readonly status: 'success' | 'failed' | 'in-progress';
  readonly duration: string;
}

export interface OrganizationSettings {
  orgName: string;
  clusterRegion: string;
  maxReplicas: number;
  autoScaling: boolean;
  billingTier: string;
  contactEmail: string;
}

export interface DeployActionInput {
  readonly serviceId: string;
  readonly targetVersion: string;
}
