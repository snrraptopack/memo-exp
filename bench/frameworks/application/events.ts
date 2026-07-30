import type { ApplicationScenario } from './contract';

export function dispatchApplicationScenario(
  root: ParentNode,
  scenario: ApplicationScenario,
): void {
  if (scenario === 'search') {
    const input = required<HTMLInputElement>(root, '#ticket-search');
    input.value = 'service 7';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return;
  }
  if (scenario === 'inspect') {
    const rows = root.querySelectorAll<HTMLButtonElement>(
      '#ticket-list .inspect-ticket',
    );
    const target = rows[
      Math.min(rows.length - 1, Math.floor(rows.length * 0.67))
    ];
    if (target === undefined) {
      throw new Error('Application benchmark has no ticket to inspect');
    }
    target.click();
    return;
  }
  const selector: Record<
    Exclude<ApplicationScenario, 'inspect' | 'search'>,
    string
  > = {
    'bulk-update': '#bulk-update-tickets',
    load: '#load-tickets',
    navigate: '#show-reports',
    organize: '#organize-tickets',
    triage: '#triage-ticket',
  };
  required<HTMLElement>(root, selector[scenario]).click();
}

function required<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(
      `Application benchmark control is missing: ${selector}`,
    );
  }
  return element;
}
