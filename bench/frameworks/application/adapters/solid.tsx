import {
  For,
  Show,
  createMemo,
  createSignal,
} from 'solid-js';
import { render } from 'solid-js/web';
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

const [state, setState] = createSignal<ApplicationState>(
  prepareApplicationState(0, 'load'),
);
let preparedCount = 0;

function TicketRow(props: {
  onInspect: () => void;
  selected: boolean;
  ticket: Ticket;
}) {
  return (
    <li
      classList={{ selected: props.selected }}
      data-priority={props.ticket.priority}
      data-status={props.ticket.status}
      data-ticket-id={props.ticket.id}
    >
      <button class="inspect-ticket" onClick={props.onInspect}>
        <span class="ticket-title">{props.ticket.title}</span>
      </button>
      <span class="ticket-owner">{props.ticket.owner}</span>
      <span class="ticket-status">{props.ticket.status}</span>
      <span class="ticket-priority">P{props.ticket.priority}</span>
    </li>
  );
}

function Metrics() {
  const summary = createMemo(() => applicationSummary(state()));
  return (
    <section class="metrics" aria-label="Ticket metrics">
      <article>Total <strong id="metric-total">{summary().total}</strong></article>
      <article>Open <strong id="metric-open">{summary().open}</strong></article>
      <article>
        Resolved <strong id="metric-resolved">{summary().resolved}</strong>
      </article>
    </section>
  );
}

function TicketView() {
  const visible = createMemo(() => visibleTickets(state()));
  const selected = createMemo(() => selectedTicket(state()));
  return (
    <section id="ticket-view" data-view="tickets">
      <div class="toolbar">
        <span>{state().query || 'All tickets'}</span>
        <span>{state().filter}</span>
        <span>{state().sort}</span>
      </div>
      <div class="workspace">
        <ul id="ticket-list">
          <For each={visible()}>
            {(ticket) => (
              <TicketRow
                onInspect={() => run('inspect')}
                selected={ticket.id === state().selectedId}
                ticket={ticket}
              />
            )}
          </For>
        </ul>
        <Show when={selected()} keyed>
          {(ticket) => (
            <aside id="ticket-detail" data-ticket-id={ticket.id}>
              <h2>{ticket.title}</h2>
              <p>{ticket.owner} · {ticket.status}</p>
              <strong id="detail-activity">{ticket.activity}</strong>
              <button id="triage-ticket" onClick={() => run('triage')}>
                Triage
              </button>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
}

function ReportView() {
  const summary = createMemo(() => applicationSummary(state()));
  return (
    <section id="report-view" data-view="reports">
      <h2>Ownership report</h2>
      <p>{summary().activity} activity events</p>
      <ul>
        <For each={ownerReport(state())}>
          {(item) => (
            <li data-report-key={item.key} data-value={item.value}>
              <span>{item.key}</span><strong>{item.value}</strong>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function App() {
  return (
    <div class="application-shell">
      <header>
        <div><small>Operations</small><h1>Issue Desk</h1></div>
        <nav aria-label="Application views">
          <button
            id="show-tickets"
            classList={{ active: state().view === 'tickets' }}
          >
            Tickets
          </button>
          <button
            id="show-reports"
            classList={{ active: state().view === 'reports' }}
            onClick={() => run('navigate')}
          >
            Reports
          </button>
        </nav>
      </header>
      <section class="actions" aria-label="Ticket actions">
        <button id="load-tickets" onClick={() => run('load')}>Load</button>
        <input
          id="ticket-search"
          value={state().query}
          onInput={() => run('search')}
        />
        <button id="organize-tickets" onClick={() => run('organize')}>
          Open by priority
        </button>
        <button id="bulk-update-tickets" onClick={() => run('bulk-update')}>
          Bulk update
        </button>
      </section>
      <Metrics />
      <main>
        <Show when={state().view === 'tickets'} fallback={<ReportView />}>
          <TicketView />
        </Show>
      </main>
    </div>
  );
}

const target = document.querySelector('#app') as HTMLElement;
render(App, target);

window.__applicationBench = {
  id: 'solid',
  label: 'Solid',
  version: __FRAMEWORK_VERSION__,
  reset(count, scenario) {
    preparedCount = count;
    setState(prepareApplicationState(count, scenario));
  },
  run(scenario) {
    dispatchApplicationScenario(target, scenario);
  },
  validate: () => readApplicationDom(target),
};

function run(scenario: ApplicationScenario): void {
  setState((current) =>
    applyApplicationScenario(current, scenario, preparedCount),
  );
}
