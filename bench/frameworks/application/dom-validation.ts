import type { ApplicationValidation } from './contract';

export function readApplicationDom(
  root: ParentNode,
): ApplicationValidation {
  const rows = Array.from(
    root.querySelectorAll<HTMLElement>('#ticket-list [data-ticket-id]'),
  );
  const detail = root.querySelector<HTMLElement>('#ticket-detail');
  const reports = Array.from(
    root.querySelectorAll<HTMLElement>('#report-view [data-report-key]'),
  );
  return {
    activity: numberText(root, '#detail-activity', -1),
    digest: rows
      .map(
        (row) =>
          `${row.dataset.ticketId}:${row.dataset.status}:` +
          `${row.dataset.priority}:` +
          `${row.querySelector('.ticket-title')?.textContent?.trim() ?? ''}`,
      )
      .join('|'),
    open: numberText(root, '#metric-open'),
    reportDigest: reports
      .map((item) => `${item.dataset.reportKey}:${item.dataset.value}`)
      .join('|'),
    resolved: numberText(root, '#metric-resolved'),
    selected: Number(detail?.dataset.ticketId ?? -1),
    total: numberText(root, '#metric-total'),
    view:
      root.querySelector<HTMLElement>('[data-view]')?.dataset.view ?? '',
    visible: rows.length,
  };
}

function numberText(
  root: ParentNode,
  selector: string,
  fallback = 0,
): number {
  const text = root.querySelector(selector)?.textContent;
  return text === null || text === undefined ? fallback : Number(text);
}
