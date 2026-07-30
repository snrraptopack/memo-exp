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

const root = document.querySelector('#app') as HTMLElement;
let state = prepareApplicationState(0, 'load');
let preparedCount = 0;

function ticketRow(ticket: Ticket): HTMLLIElement {
  const item = document.createElement('li');
  item.dataset.ticketId = String(ticket.id);
  item.dataset.status = ticket.status;
  item.dataset.priority = String(ticket.priority);
  item.className = ticket.id === state.selectedId ? 'selected' : '';
  item.innerHTML =
    '<button class="inspect-ticket">' +
    `<span class="ticket-title">${ticket.title}</span></button>` +
    `<span class="ticket-owner">${ticket.owner}</span>` +
    `<span class="ticket-status">${ticket.status}</span>` +
    `<span class="ticket-priority">P${ticket.priority}</span>`;
  item
    .querySelector('.inspect-ticket')!
    .addEventListener('click', () => runScenario('inspect'));
  return item;
}

function ticketDetail(ticket: Ticket): HTMLElement {
  const detail = document.createElement('aside');
  detail.id = 'ticket-detail';
  detail.dataset.ticketId = String(ticket.id);
  detail.innerHTML =
    `<h2>${ticket.title}</h2>` +
    `<p>${ticket.owner} · ${ticket.status}</p>` +
    `<strong id="detail-activity">${ticket.activity}</strong>` +
    '<button id="triage-ticket">Triage</button>';
  detail
    .querySelector('#triage-ticket')!
    .addEventListener('click', () => runScenario('triage'));
  return detail;
}

function renderMetrics(): void {
  const summary = applicationSummary(state);
  root.querySelector('#metric-total')!.textContent = String(summary.total);
  root.querySelector('#metric-open')!.textContent = String(summary.open);
  root.querySelector('#metric-resolved')!.textContent = String(
    summary.resolved,
  );
}

function renderTicketList(): void {
  const list = root.querySelector('#ticket-list')!;
  list.replaceChildren(...visibleTickets(state).map(ticketRow));
}

function renderTicketView(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'ticket-view';
  section.dataset.view = 'tickets';
  section.innerHTML =
    '<div class="toolbar"><span></span><span></span><span></span></div>' +
    '<div class="workspace"><ul id="ticket-list"></ul></div>';
  const toolbar = section.querySelectorAll('.toolbar span');
  toolbar[0]!.textContent = state.query || 'All tickets';
  toolbar[1]!.textContent = state.filter;
  toolbar[2]!.textContent = state.sort;
  const list = section.querySelector('#ticket-list')!;
  list.append(...visibleTickets(state).map(ticketRow));
  const selected = selectedTicket(state);
  if (selected) section.querySelector('.workspace')!.append(ticketDetail(selected));
  return section;
}

function renderReportView(): HTMLElement {
  const summary = applicationSummary(state);
  const section = document.createElement('section');
  section.id = 'report-view';
  section.dataset.view = 'reports';
  section.innerHTML =
    '<h2>Ownership report</h2>' +
    `<p>${summary.activity} activity events</p><ul></ul>`;
  const list = section.querySelector('ul')!;
  for (const report of ownerReport(state)) {
    const item = document.createElement('li');
    item.dataset.reportKey = report.key;
    item.dataset.value = String(report.value);
    item.innerHTML =
      `<span>${report.key}</span><strong>${report.value}</strong>`;
    list.append(item);
  }
  return section;
}

function renderMain(): void {
  root
    .querySelector('main')!
    .replaceChildren(
      state.view === 'tickets' ? renderTicketView() : renderReportView(),
    );
  const tabs = root.querySelectorAll('nav button');
  tabs[0]!.className = state.view === 'tickets' ? 'active' : '';
  tabs[1]!.className = state.view === 'reports' ? 'active' : '';
}

function renderShell(): void {
  root.innerHTML = `
    <div class="application-shell">
      <header>
        <div><small>Operations</small><h1>Issue Desk</h1></div>
        <nav aria-label="Application views">
          <button id="show-tickets">Tickets</button>
          <button id="show-reports">Reports</button>
        </nav>
      </header>
      <section class="actions" aria-label="Ticket actions">
        <button id="load-tickets">Load</button>
        <input id="ticket-search" />
        <button id="organize-tickets">Open by priority</button>
        <button id="bulk-update-tickets">Bulk update</button>
      </section>
      <section class="metrics" aria-label="Ticket metrics">
        <article>Total <strong id="metric-total"></strong></article>
        <article>Open <strong id="metric-open"></strong></article>
        <article>Resolved <strong id="metric-resolved"></strong></article>
      </section>
      <main></main>
    </div>`;
  renderMetrics();
  renderMain();
  root
    .querySelector('#load-tickets')!
    .addEventListener('click', () => runScenario('load'));
  root
    .querySelector('#ticket-search')!
    .addEventListener('input', () => runScenario('search'));
  root
    .querySelector('#organize-tickets')!
    .addEventListener('click', () => runScenario('organize'));
  root
    .querySelector('#bulk-update-tickets')!
    .addEventListener('click', () => runScenario('bulk-update'));
  root
    .querySelector('#show-reports')!
    .addEventListener('click', () => runScenario('navigate'));
}

function patch(previous: ApplicationState, scenario: ApplicationScenario): void {
  renderMetrics();
  if (previous.view !== state.view || scenario === 'load') {
    renderMain();
    return;
  }
  if (scenario === 'search' || scenario === 'organize') {
    const toolbar = root.querySelectorAll('.toolbar span');
    toolbar[0]!.textContent = state.query || 'All tickets';
    toolbar[1]!.textContent = state.filter;
    toolbar[2]!.textContent = state.sort;
    renderTicketList();
    return;
  }
  if (scenario === 'inspect') {
    const oldSelected = root.querySelector('.selected');
    oldSelected?.classList.remove('selected');
    const selected = selectedTicket(state)!;
    root
      .querySelector(`[data-ticket-id="${selected.id}"]`)
      ?.classList.add('selected');
    root.querySelector('#ticket-detail')?.remove();
    root.querySelector('.workspace')!.append(ticketDetail(selected));
    return;
  }
  const changed = state.tickets.filter(
    (ticket, index) => ticket !== previous.tickets[index],
  );
  for (const ticket of changed) {
    const current = root.querySelector(
      `[data-ticket-id="${ticket.id}"]`,
    );
    current?.replaceWith(ticketRow(ticket));
  }
  const selected = selectedTicket(state);
  if (selected) {
    root.querySelector('#ticket-detail')?.replaceWith(ticketDetail(selected));
  }
}

renderShell();

window.__applicationBench = {
  id: 'vanilla',
  label: 'Vanilla DOM',
  version: 'browser',
  reset(count, scenario) {
    preparedCount = count;
    state = prepareApplicationState(count, scenario);
    renderShell();
  },
  run(scenario) {
    dispatchApplicationScenario(root, scenario);
  },
  validate: () => readApplicationDom(root),
};

function runScenario(scenario: ApplicationScenario): void {
  const previous = state;
  state = applyApplicationScenario(state, scenario, preparedCount);
  patch(previous, scenario);
}
