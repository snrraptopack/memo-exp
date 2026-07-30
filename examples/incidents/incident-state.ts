export type CheckStatus = 'passing' | 'warning' | 'failed';
export type BoardMode = 'live' | 'paused' | 'maintenance';

export interface ServiceCheck {
  id: string;
  label: string;
  status: CheckStatus;
}

export interface Service {
  id: string;
  name: string;
  owner: string;
  region: string;
  checks: ServiceCheck[];
}

export let boardMode: BoardMode = 'live';
export let services: Service[] = [
  {
    id: 'gateway',
    name: 'Edge Gateway',
    owner: 'Traffic',
    region: 'iad-1',
    checks: [
      { id: 'latency', label: 'P95 latency', status: 'warning' },
      { id: 'errors', label: 'Error budget', status: 'passing' },
      { id: 'tls', label: 'TLS handshakes', status: 'passing' },
    ],
  },
  {
    id: 'billing',
    name: 'Billing API',
    owner: 'Payments',
    region: 'fra-2',
    checks: [
      { id: 'charges', label: 'Charge success', status: 'failed' },
      { id: 'webhooks', label: 'Webhook queue', status: 'warning' },
    ],
  },
  {
    id: 'search',
    name: 'Search Index',
    owner: 'Discovery',
    region: 'sin-1',
    checks: [
      { id: 'freshness', label: 'Index freshness', status: 'passing' },
      { id: 'coverage', label: 'Document coverage', status: 'passing' },
    ],
  },
];

function advanceStatus(status: CheckStatus): CheckStatus {
  switch (status) {
    case 'passing':
      return 'warning';
    case 'warning':
      return 'failed';
    default:
      return 'passing';
  }
}

export function setBoardMode(mode: BoardMode) {
  boardMode = mode;
}

export function rotateServices() {
  if (services.length < 2) return;
  services = [...services.slice(1), services[0]!];
}

export function cycleCheck(serviceId: string, checkId: string) {
  services = services.map((service) => {
    if (service.id !== serviceId) return service;
    return {
      ...service,
      checks: service.checks.map((check) =>
        check.id === checkId
          ? { ...check, status: advanceStatus(check.status) }
          : check
      ),
    };
  });
}

export function restorePassing() {
  services = services.map((service) => ({
    ...service,
    checks: service.checks.map((check) => ({
      ...check,
      status: 'passing',
    })),
  }));
}
