<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ApplicationScenario } from '../contract';
import {
  applicationSummary,
  applyApplicationScenario,
  ownerReport,
  prepareApplicationState,
  selectedTicket,
  visibleTickets,
} from '../model';

const state = ref(prepareApplicationState(0, 'load'));
let preparedCount = 0;
const summary = computed(() => applicationSummary(state.value));
const visible = computed(() => visibleTickets(state.value));
const selected = computed(() => selectedTicket(state.value));
const reports = computed(() => ownerReport(state.value));

function reset(count: number, scenario: ApplicationScenario): void {
  preparedCount = count;
  state.value = prepareApplicationState(count, scenario);
}

function run(scenario: ApplicationScenario): void {
  state.value = applyApplicationScenario(
    state.value,
    scenario,
    preparedCount,
  );
}

defineExpose({ reset, run });
</script>

<template>
  <div class="application-shell">
    <header>
      <div><small>Operations</small><h1>Issue Desk</h1></div>
      <nav aria-label="Application views">
        <button
          id="show-tickets"
          :class="{ active: state.view === 'tickets' }"
        >Tickets</button>
        <button
          id="show-reports"
          :class="{ active: state.view === 'reports' }"
          @click="run('navigate')"
        >Reports</button>
      </nav>
    </header>
    <section class="actions" aria-label="Ticket actions">
      <button id="load-tickets" @click="run('load')">Load</button>
      <input
        id="ticket-search"
        :value="state.query"
        @input="run('search')"
      />
      <button id="organize-tickets" @click="run('organize')">
        Open by priority
      </button>
      <button id="bulk-update-tickets" @click="run('bulk-update')">
        Bulk update
      </button>
    </section>
    <section class="metrics" aria-label="Ticket metrics">
      <article>Total <strong id="metric-total">{{ summary.total }}</strong></article>
      <article>Open <strong id="metric-open">{{ summary.open }}</strong></article>
      <article>Resolved <strong id="metric-resolved">{{ summary.resolved }}</strong></article>
    </section>
    <main>
      <section v-if="state.view === 'tickets'" id="ticket-view" data-view="tickets">
        <div class="toolbar">
          <span>{{ state.query || 'All tickets' }}</span>
          <span>{{ state.filter }}</span>
          <span>{{ state.sort }}</span>
        </div>
        <div class="workspace">
          <ul id="ticket-list">
            <li
              v-for="ticket in visible"
              :key="ticket.id"
              :class="{ selected: ticket.id === state.selectedId }"
              :data-priority="ticket.priority"
              :data-status="ticket.status"
              :data-ticket-id="ticket.id"
            >
              <button class="inspect-ticket" @click="run('inspect')">
                <span class="ticket-title">{{ ticket.title }}</span>
              </button>
              <span class="ticket-owner">{{ ticket.owner }}</span>
              <span class="ticket-status">{{ ticket.status }}</span>
              <span class="ticket-priority">P{{ ticket.priority }}</span>
            </li>
          </ul>
          <aside
            v-if="selected"
            id="ticket-detail"
            :data-ticket-id="selected.id"
          >
            <h2>{{ selected.title }}</h2>
            <p>{{ selected.owner }} · {{ selected.status }}</p>
            <strong id="detail-activity">{{ selected.activity }}</strong>
            <button id="triage-ticket" @click="run('triage')">Triage</button>
          </aside>
        </div>
      </section>
      <section v-else id="report-view" data-view="reports">
        <h2>Ownership report</h2>
        <p>{{ summary.activity }} activity events</p>
        <ul>
          <li
            v-for="report in reports"
            :key="report.key"
            :data-report-key="report.key"
            :data-value="report.value"
          >
            <span>{{ report.key }}</span><strong>{{ report.value }}</strong>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
