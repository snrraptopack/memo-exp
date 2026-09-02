import type { Activity, LabScenario, Metrics, Profile } from './types';

function delayed(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(new DOMException('Request aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('Request aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function scenarioOf(url: URL): LabScenario {
  const value = url.searchParams.get('scenario');
  if (
    value === 'colorless-tsx' || value === 'suspended-tsx' ||
    value === 'suspended-tsrx' || value === 'colorless-tsrx'
  ) return value;
  return 'colorless-tsx';
}

function profile(scenario: LabScenario): Profile {
  return {
    name: scenario.includes('tsrx') ? 'Mira Chen' : 'Ada Mensah',
    role: scenario.includes('suspended') ? 'Platform lead' : 'Runtime engineer',
    region: 'São Tomé · ST-1',
    initials: scenario.includes('tsrx') ? 'MC' : 'AM',
  };
}

/** Fetch-compatible deterministic transport with intentionally staggered responses. */
export function createLabFetch(): typeof fetch {
  const attempts = new Map<string, number>();
  const latency = { profile: 900, metrics: 2100, activity: 3400 } as const;
  const metrics: Metrics = {
    availability: '99.982%',
    requests: '2.48M',
    latency: '38 ms',
  };
  const activity: Activity = {
    latestDeploy: 'compiler-estree.1842',
    environment: 'edge-production',
    status: 'Healthy',
  };

  const request = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const authored = input instanceof Request ? input : null;
    const url = new URL(authored?.url ?? String(input), window.location.origin);
    const kind = url.pathname.split('/').at(-1);
    const scenario = scenarioOf(url);
    const signal = init?.signal ?? authored?.signal;
    const key = `${scenario}:${kind ?? 'unknown'}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);

    if (kind !== 'profile' && kind !== 'metrics' && kind !== 'activity') {
      return json({ message: `Unknown lab endpoint: ${url.pathname}` }, 404);
    }

    await delayed(latency[kind], signal ?? undefined);
    if (scenario === 'colorless-tsrx' && kind === 'profile' && attempt === 1) {
      return json({
        message: 'The profile shard intentionally failed on its first attempt.',
      }, 503);
    }
    if (kind === 'profile') return json(profile(scenario));
    if (kind === 'metrics') return json(metrics);
    return json(activity);
  };

  return request as typeof fetch;
}
