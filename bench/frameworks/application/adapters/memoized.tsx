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

const store: { state: ApplicationState } = {
  state: prepareApplicationState(0, 'load'),
};
let preparedCount = 0;

interface ApplicationControls {
  reset(count: number, scenario: ApplicationScenario): void;
}

export let applicationControls: ApplicationControls;

function publishControls(
  reset: ApplicationControls['reset'],
): void {
  applicationControls = { reset };
}

function Metrics(props: { state: ApplicationState }) {
  const summary = applicationSummary(props.state);
  return (
    <section class="metrics" aria-label="Ticket metrics">
      <article>Total <strong id="metric-total">{summary.total}</strong></article>
      <article>Open <strong id="metric-open">{summary.open}</strong></article>
      <article>
        Resolved <strong id="metric-resolved">{summary.resolved}</strong>
      </article>
    </section>
  );
}

function TicketRow(props: {
  onInspect: () => void;
  selected: boolean;
  ticket: Ticket;
}) {
  return (
    <li
      class={props.selected ? 'selected' : ''}
      data-priority={String(props.ticket.priority)}
      data-status={props.ticket.status}
      data-ticket-id={String(props.ticket.id)}
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

function TicketDetail(props: { onTriage: () => void; ticket: Ticket }) {
  return (
    <aside id="ticket-detail" data-ticket-id={String(props.ticket.id)}>
      <h2>{props.ticket.title}</h2>
      <p>{props.ticket.owner} · {props.ticket.status}</p>
      <strong id="detail-activity">{props.ticket.activity}</strong>
      <button id="triage-ticket" onClick={props.onTriage}>Triage</button>
    </aside>
  );
}

function TicketView(props: {
  onInspect: () => void;
  onTriage: () => void;
  state: ApplicationState;
}) {
  const visible = visibleTickets(props.state);
  const selected = selectedTicket(props.state);
  return (
    <section id="ticket-view" data-view="tickets">
      <div class="toolbar">
        <span>{props.state.query || 'All tickets'}</span>
        <span>{props.state.filter}</span>
        <span>{props.state.sort}</span>
      </div>
      <div class="workspace">
        <ul id="ticket-list">
          {visible.map((ticket) => (
            <TicketRow
              key={ticket.id}
              onInspect={props.onInspect}
              selected={ticket.id === props.state.selectedId}
              ticket={ticket}
            />
          ))}
        </ul>
        {selected ? (
          <TicketDetail onTriage={props.onTriage} ticket={selected} />
        ) : null}
      </div>
    </section>
  );
}

function ReportView(props: { state: ApplicationState }) {
  const summary = applicationSummary(props.state);
  return (
    <section id="report-view" data-view="reports">
      <h2>Ownership report</h2>
      <p>{summary.activity} activity events</p>
      <ul>
        {ownerReport(props.state).map((item) => (
          <li
            key={item.key}
            data-report-key={item.key}
            data-value={String(item.value)}
          >
            <span>{item.key}</span>
            <strong>{item.value}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ApplicationApp() {
  const reset = (
    count: number,
    scenario: ApplicationScenario,
  ): void => {
    preparedCount = count;
    store.state = prepareApplicationState(count, scenario);
  };
  const run = (scenario: ApplicationScenario): void => {
    store.state = applyApplicationScenario(
      store.state,
      scenario,
      preparedCount,
    );
  };
  publishControls(reset);

  return (
    <div class="application-shell">
      <header>
        <div>
          <small>Operations</small>
          <h1>Issue Desk</h1>
        </div>
        <nav aria-label="Application views">
          <button
            id="show-tickets"
            class={store.state.view === 'tickets' ? 'active' : ''}
          >
            Tickets
          </button>
          <button
            id="show-reports"
            class={store.state.view === 'reports' ? 'active' : ''}
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
          value={store.state.query}
          onInput={() => run('search')}
        />
        <button id="organize-tickets" onClick={() => run('organize')}>
          Open by priority
        </button>
        <button id="bulk-update-tickets" onClick={() => run('bulk-update')}>
          Bulk update
        </button>
      </section>
      <Metrics state={store.state} />
      <main>
        {store.state.view === 'tickets' ? (
          <TicketView
            onInspect={() => run('inspect')}
            onTriage={() => run('triage')}
            state={store.state}
          />
        ) : (
          <ReportView state={store.state} />
        )}
      </main>
    </div>
  );
}
