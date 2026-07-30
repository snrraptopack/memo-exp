import {
  memo,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ApplicationScenario } from '../contract';
import {
  applicationSummary,
  applyApplicationScenario,
  ownerReport,
  prepareApplicationState,
  selectedTicket,
  visibleTickets,
  type ApplicationState,
  type Ticket,
} from '../model';
import { readApplicationDom } from '../dom-validation';
import { dispatchApplicationScenario } from '../events';

declare const __FRAMEWORK_VERSION__: string;

let generation = 0;
let resolveCommit: (() => void) | undefined;

const TicketRow = memo(function TicketRow(props: {
  onInspect: () => void;
  selected: boolean;
  ticket: Ticket;
}) {
  return (
    <li
      className={props.selected ? 'selected' : ''}
      data-priority={props.ticket.priority}
      data-status={props.ticket.status}
      data-ticket-id={props.ticket.id}
    >
      <button className="inspect-ticket" onClick={props.onInspect}>
        <span className="ticket-title">{props.ticket.title}</span>
      </button>
      <span className="ticket-owner">{props.ticket.owner}</span>
      <span className="ticket-status">{props.ticket.status}</span>
      <span className="ticket-priority">P{props.ticket.priority}</span>
    </li>
  );
});

function Metrics({ state }: { state: ApplicationState }) {
  const summary = applicationSummary(state);
  return (
    <section className="metrics" aria-label="Ticket metrics">
      <article>Total <strong id="metric-total">{summary.total}</strong></article>
      <article>Open <strong id="metric-open">{summary.open}</strong></article>
      <article>
        Resolved <strong id="metric-resolved">{summary.resolved}</strong>
      </article>
    </section>
  );
}

function TicketView(props: {
  onInspect: () => void;
  onTriage: () => void;
  state: ApplicationState;
}) {
  const { state } = props;
  const visible = visibleTickets(state);
  const selected = selectedTicket(state);
  return (
    <section id="ticket-view" data-view="tickets">
      <div className="toolbar">
        <span>{state.query || 'All tickets'}</span>
        <span>{state.filter}</span>
        <span>{state.sort}</span>
      </div>
      <div className="workspace">
        <ul id="ticket-list">
          {visible.map((ticket) => (
            <TicketRow
              key={ticket.id}
              onInspect={props.onInspect}
              selected={ticket.id === state.selectedId}
              ticket={ticket}
            />
          ))}
        </ul>
        {selected ? (
          <aside id="ticket-detail" data-ticket-id={selected.id}>
            <h2>{selected.title}</h2>
            <p>{selected.owner} · {selected.status}</p>
            <strong id="detail-activity">{selected.activity}</strong>
            <button
              id="triage-ticket"
              onClick={props.onTriage}
            >
              Triage
            </button>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function ReportView({ state }: { state: ApplicationState }) {
  const summary = applicationSummary(state);
  return (
    <section id="report-view" data-view="reports">
      <h2>Ownership report</h2>
      <p>{summary.activity} activity events</p>
      <ul>
        {ownerReport(state).map((item) => (
          <li
            key={item.key}
            data-report-key={item.key}
            data-value={item.value}
          >
            <span>{item.key}</span>
            <strong>{item.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function App(props: {
  count: number;
  initial: ApplicationState;
}) {
  const [state, setState] = useState(props.initial);
  useLayoutEffect(() => {
    resolveCommit?.();
    resolveCommit = undefined;
  });
  const run = useCallback(
    (scenario: ApplicationScenario): void => {
      setState((current) =>
        applyApplicationScenario(current, scenario, props.count),
      );
    },
    [props.count],
  );
  const inspect = useCallback(() => run('inspect'), [run]);
  const triage = useCallback(() => run('triage'), [run]);
  return (
    <div className="application-shell">
      <header>
        <div><small>Operations</small><h1>Issue Desk</h1></div>
        <nav aria-label="Application views">
          <button
            id="show-tickets"
            className={state.view === 'tickets' ? 'active' : ''}
          >
            Tickets
          </button>
          <button
            id="show-reports"
            className={state.view === 'reports' ? 'active' : ''}
            onClick={() => run('navigate')}
          >
            Reports
          </button>
        </nav>
      </header>
      <section className="actions" aria-label="Ticket actions">
        <button id="load-tickets" onClick={() => run('load')}>Load</button>
        <input
          id="ticket-search"
          value={state.query}
          onInput={() => run('search')}
        />
        <button id="organize-tickets" onClick={() => run('organize')}>
          Open by priority
        </button>
        <button
          id="bulk-update-tickets"
          onClick={() => run('bulk-update')}
        >
          Bulk update
        </button>
      </section>
      <Metrics state={state} />
      <main>
        {state.view === 'tickets' ? (
          <TicketView
            onInspect={inspect}
            onTriage={triage}
            state={state}
          />
        ) : (
          <ReportView state={state} />
        )}
      </main>
    </div>
  );
}

const target = document.querySelector('#app') as HTMLElement;
const root = createRoot(target);

window.__applicationBench = {
  id: 'react',
  label: 'React',
  version: __FRAMEWORK_VERSION__,
  reset(count, scenario) {
    flushSync(() => {
      root.render(
        <App
          key={++generation}
          count={count}
          initial={prepareApplicationState(count, scenario)}
        />,
      );
    });
  },
  run(scenario) {
    return new Promise<void>((resolve) => {
      resolveCommit = resolve;
      dispatchApplicationScenario(target, scenario);
    });
  },
  validate: () => readApplicationDom(target),
};
