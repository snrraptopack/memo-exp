import type { Service } from './incident-state';

interface ServiceCardProps {
  service: Service;
  serviceIndex: number;
  onCycleCheck: (serviceId: string, checkId: string) => void;
}

export function ServiceCard({
  service,
  serviceIndex,
  onCycleCheck,
}: ServiceCardProps) {
  const failedCount = service.checks.filter(
    (check) => check.status === 'failed',
  ).length;
  const warningCount = service.checks.filter(
    (check) => check.status === 'warning',
  ).length;

  let health = 'healthy';
  let healthLabel = 'Operational';
  if (failedCount > 0) {
    health = 'critical';
    healthLabel = 'Action required';
  } else if (warningCount > 0) {
    health = 'degraded';
    healthLabel = 'Degraded';
  }

  return (
    <article class={`incident-service-card ${health}`}>
      <header class="incident-service-header">
        <div>
          <span class="incident-service-index">{serviceIndex + 1}</span>
          <h2>{service.name}</h2>
          <p>{service.owner} · {service.region}</p>
        </div>
        <span class={`incident-health ${health}`}>{healthLabel}</span>
      </header>

      {failedCount > 0 ? (
        <div class="incident-callout critical">
          <strong>{failedCount} failed check</strong>
          {failedCount > 1
            ? <span>Coordinate a multi-check response.</span>
            : 'Assign an incident commander.'}
        </div>
      ) : warningCount > 0 ? (
        <div class="incident-callout warning">
          <strong>Monitoring drift</strong>
          <span>{warningCount} warning checks are being watched.</span>
        </div>
      ) : (
        'All checks are inside their target range.'
      )}

      <ul class="incident-check-list">
        {service.checks.map(({ id, label, status }, checkIndex) => {
          return (
            <li
              key={id}
              class={`incident-check ${status}`}
              onClick={() => onCycleCheck(service.id, id)}
            >
              <span class="incident-check-order">{checkIndex + 1}</span>
              <span class="incident-check-name">{label}</span>
              <span class={`incident-check-state ${status}`}>
                {status === 'failed'
                  ? <strong>Failed</strong>
                  : status === 'warning'
                    ? 'Warning'
                    : null}
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
