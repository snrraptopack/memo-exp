<script lang="ts">
  import type { ApplicationScenario } from '../contract';
  import {
    applicationSummary,
    applyApplicationScenario,
    ownerReport,
    prepareApplicationState,
    selectedTicket,
    visibleTickets,
  } from '../model';

  let state = $state(prepareApplicationState(0, 'load'));
  let preparedCount = 0;
  let summary = $derived(applicationSummary(state));
  let visible = $derived(visibleTickets(state));
  let selected = $derived(selectedTicket(state));
  let reports = $derived(ownerReport(state));

  export function reset(
    count: number,
    scenario: ApplicationScenario,
  ): void {
    preparedCount = count;
    state = prepareApplicationState(count, scenario);
  }

  export function run(scenario: ApplicationScenario): void {
    state = applyApplicationScenario(state, scenario, preparedCount);
  }
</script>

<div class="application-shell">
  <header>
    <div><small>Operations</small><h1>Issue Desk</h1></div>
    <nav aria-label="Application views">
      <button
        id="show-tickets"
        class:active={state.view === 'tickets'}
      >Tickets</button>
      <button
        id="show-reports"
        class:active={state.view === 'reports'}
        onclick={() => run('navigate')}
      >Reports</button>
    </nav>
  </header>
  <section class="actions" aria-label="Ticket actions">
    <button id="load-tickets" onclick={() => run('load')}>Load</button>
    <input
      id="ticket-search"
      value={state.query}
      oninput={() => run('search')}
    />
    <button id="organize-tickets" onclick={() => run('organize')}>
      Open by priority
    </button>
    <button id="bulk-update-tickets" onclick={() => run('bulk-update')}>
      Bulk update
    </button>
  </section>
  <section class="metrics" aria-label="Ticket metrics">
    <article>Total <strong id="metric-total">{summary.total}</strong></article>
    <article>Open <strong id="metric-open">{summary.open}</strong></article>
    <article>
      Resolved <strong id="metric-resolved">{summary.resolved}</strong>
    </article>
  </section>
  <main>
    {#if state.view === 'tickets'}
      <section id="ticket-view" data-view="tickets">
        <div class="toolbar">
          <span>{state.query || 'All tickets'}</span>
          <span>{state.filter}</span>
          <span>{state.sort}</span>
        </div>
        <div class="workspace">
          <ul id="ticket-list">
            {#each visible as ticket (ticket.id)}
              <li
                class:selected={ticket.id === state.selectedId}
                data-priority={ticket.priority}
                data-status={ticket.status}
                data-ticket-id={ticket.id}
              >
                <button class="inspect-ticket" onclick={() => run('inspect')}>
                  <span class="ticket-title">{ticket.title}</span>
                </button>
                <span class="ticket-owner">{ticket.owner}</span>
                <span class="ticket-status">{ticket.status}</span>
                <span class="ticket-priority">P{ticket.priority}</span>
              </li>
            {/each}
          </ul>
          {#if selected}
            <aside id="ticket-detail" data-ticket-id={selected.id}>
              <h2>{selected.title}</h2>
              <p>{selected.owner} · {selected.status}</p>
              <strong id="detail-activity">{selected.activity}</strong>
              <button id="triage-ticket" onclick={() => run('triage')}>
                Triage
              </button>
            </aside>
          {/if}
        </div>
      </section>
    {:else}
      <section id="report-view" data-view="reports">
        <h2>Ownership report</h2>
        <p>{summary.activity} activity events</p>
        <ul>
          {#each reports as report (report.key)}
            <li data-report-key={report.key} data-value={report.value}>
              <span>{report.key}</span><strong>{report.value}</strong>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </main>
</div>
