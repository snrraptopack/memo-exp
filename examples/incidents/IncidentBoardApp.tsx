import {
  boardMode,
  services,
  cycleCheck,
  restorePassing,
  rotateServices,
  setBoardMode,
} from './incident-state';
import { ServiceCard } from './ServiceCard';

export function IncidentBoardApp() {
  const failedChecks = services
    .flatMap((service) => service.checks)
    .filter((check) => check.status === 'failed').length;
  const warningChecks = services
    .flatMap((service) => service.checks)
    .filter((check) => check.status === 'warning').length;
  const boardSummary = `${failedChecks} failed · ${warningChecks} warning`;

  effect(() => {
    console.log('[Incident Board]', boardSummary);
  });

  if (boardMode === 'maintenance') {
    return (
      <main class="incident-maintenance">
        <span class="incident-maintenance-icon">🛠️</span>
        <p class="incident-eyebrow">Structural early return</p>
        <h1>Board maintenance in progress</h1>
        <p>The same component instance can return to its live keyed regions.</p>
        <button onClick={() => setBoardMode('live')}>Resume operations</button>
      </main>
    );
  }

  let boardTitle = 'Incident command';
  switch (boardMode) {
    case 'live':
      boardTitle = 'Live incident command';
      break;
    case 'paused':
      boardTitle = 'Incident command paused';
      break;
  }

  return (
    <main class="incident-board">
      <header class="incident-board-header">
        <div>
          <p class="incident-eyebrow">Memoized DOM composition laboratory</p>
          <h1>{boardTitle}</h1>
          <p class="incident-board-subtitle">
            Click any check to cycle its state. Reorder services to verify
            keyed rows retain their DOM while indices update.
          </p>
        </div>
        <div class="incident-board-status">
          {boardMode === 'live'
            ? <span class="incident-live-dot">Streaming updates</span>
            : 'Updates are held locally'}
          <strong>{boardSummary}</strong>
        </div>
      </header>

      <nav class="incident-actions">
        <button
          class={boardMode === 'live' ? 'active' : ''}
          onClick={() => setBoardMode('live')}
        >
          Live
        </button>
        <button
          class={boardMode === 'paused' ? 'active' : ''}
          onClick={() => setBoardMode('paused')}
        >
          Pause
        </button>
        <button onClick={() => rotateServices()}>Rotate services</button>
        <button onClick={() => restorePassing()}>Restore passing</button>
        <button onClick={() => setBoardMode('maintenance')}>
          Maintenance return
        </button>
      </nav>

      <section class="incident-feature-strip">
        <span>map item + index</span>
        <span>block return</span>
        <span>destructured rows</span>
        <span>mixed branches</span>
        <span>nested keyed lists</span>
      </section>

      <section class="incident-service-grid">
        {services.map((service, serviceIndex) => {
          return (
            <ServiceCard
              key={service.id}
              service={service}
              serviceIndex={serviceIndex}
              onCycleCheck={cycleCheck}
            />
          );
        })}
      </section>
    </main>
  );
}
