import type {
  ApplicationScenario,
  ApplicationValidation,
} from './contract';

export type TicketStatus = 'open' | 'in-progress' | 'resolved';
export type TicketFilter = 'all' | TicketStatus;
export type TicketSort = 'id' | 'priority';
export type ApplicationView = 'tickets' | 'reports';

export interface Ticket {
  activity: number;
  id: number;
  owner: string;
  priority: number;
  status: TicketStatus;
  title: string;
}

export interface ApplicationState {
  filter: TicketFilter;
  query: string;
  selectedId: number | null;
  sort: TicketSort;
  tickets: Ticket[];
  view: ApplicationView;
}

export interface ApplicationSummary {
  activity: number;
  inProgress: number;
  open: number;
  resolved: number;
  total: number;
}

const owners = ['Platform', 'Payments', 'Search', 'Mobile'] as const;

export function makeApplicationState(count: number): ApplicationState {
  return {
    filter: 'all',
    query: '',
    selectedId: null,
    sort: 'id',
    tickets: Array.from({ length: count }, (_, index) => {
      const id = index + 1;
      return {
        activity: (id * 3) % 9,
        id,
        owner: owners[id % owners.length]!,
        priority: ((id * 7) % 4) + 1,
        status: initialStatus(id),
        title: `Incident ${id}: service ${id % 23}`,
      };
    }),
    view: 'tickets',
  };
}

export function prepareApplicationState(
  count: number,
  scenario: ApplicationScenario,
): ApplicationState {
  const state = makeApplicationState(scenario === 'load' ? 0 : count);
  if (scenario === 'triage' && state.tickets.length > 0) {
    state.selectedId = triageTicket(state).id;
  }
  return state;
}

export function applyApplicationScenario(
  state: ApplicationState,
  scenario: ApplicationScenario,
  count: number,
): ApplicationState {
  if (scenario === 'load') return makeApplicationState(count);
  if (scenario === 'inspect') {
    return {
      ...state,
      selectedId: inspectTicket(state).id,
    };
  }
  if (scenario === 'triage') {
    const selected = triageTicket(state);
    return {
      ...state,
      tickets: state.tickets.map((ticket) =>
        ticket.id === selected.id
          ? {
              ...ticket,
              activity: ticket.activity + 1,
              priority: (ticket.priority % 4) + 1,
              status: nextStatus(ticket.status),
            }
          : ticket,
      ),
    };
  }
  if (scenario === 'search') {
    return { ...state, query: 'service 7' };
  }
  if (scenario === 'organize') {
    return { ...state, filter: 'open', sort: 'priority' };
  }
  if (scenario === 'navigate') {
    return { ...state, view: 'reports' };
  }
  return {
    ...state,
    tickets: state.tickets.map((ticket, index) =>
      index % 10 === 0
        ? {
            ...ticket,
            activity: ticket.activity + 1,
            status: nextStatus(ticket.status),
          }
        : ticket,
    ),
  };
}

export function visibleTickets(state: ApplicationState): Ticket[] {
  const query = state.query.toLowerCase();
  const visible = state.tickets.filter(
    (ticket) =>
      (state.filter === 'all' || ticket.status === state.filter) &&
      (query.length === 0 ||
        ticket.title.toLowerCase().includes(query) ||
        ticket.owner.toLowerCase().includes(query)),
  );
  if (state.sort === 'id') return visible;
  return visible.slice().sort(
    (left, right) =>
      right.priority - left.priority || left.id - right.id,
  );
}

export function selectedTicket(
  state: ApplicationState,
): Ticket | undefined {
  return state.tickets.find((ticket) => ticket.id === state.selectedId);
}

export function applicationSummary(
  state: ApplicationState,
): ApplicationSummary {
  let activity = 0;
  let inProgress = 0;
  let open = 0;
  let resolved = 0;
  for (const ticket of state.tickets) {
    activity += ticket.activity;
    if (ticket.status === 'open') open++;
    else if (ticket.status === 'in-progress') inProgress++;
    else resolved++;
  }
  return {
    activity,
    inProgress,
    open,
    resolved,
    total: state.tickets.length,
  };
}

export function ownerReport(state: ApplicationState): Array<{
  key: string;
  value: number;
}> {
  return owners.map((owner) => ({
    key: owner,
    value: state.tickets.filter((ticket) => ticket.owner === owner).length,
  }));
}

export function expectedApplicationValidation(
  state: ApplicationState,
): ApplicationValidation {
  const summary = applicationSummary(state);
  const selected = selectedTicket(state);
  const visible = state.view === 'tickets' ? visibleTickets(state) : [];
  return {
    activity: selected?.activity ?? -1,
    digest: ticketDigest(visible),
    open: summary.open,
    reportDigest:
      state.view === 'reports'
        ? ownerReport(state)
            .map((item) => `${item.key}:${item.value}`)
            .join('|')
        : '',
    resolved: summary.resolved,
    selected: selected?.id ?? -1,
    total: summary.total,
    view: state.view,
    visible: visible.length,
  };
}

export function ticketDigest(tickets: readonly Ticket[]): string {
  return tickets
    .map(
      (ticket) =>
        `${ticket.id}:${ticket.status}:${ticket.priority}:${ticket.title}`,
    )
    .join('|');
}

function initialStatus(id: number): TicketStatus {
  if (id % 4 === 0) return 'resolved';
  if (id % 4 === 2) return 'in-progress';
  return 'open';
}

function nextStatus(status: TicketStatus): TicketStatus {
  if (status === 'open') return 'in-progress';
  if (status === 'in-progress') return 'resolved';
  return 'open';
}

function inspectTicket(state: ApplicationState): Ticket {
  return state.tickets[
    Math.min(state.tickets.length - 1, Math.floor(state.tickets.length * 0.67))
  ]!;
}

function triageTicket(state: ApplicationState): Ticket {
  return state.tickets[Math.min(state.tickets.length - 1, 10)]!;
}
