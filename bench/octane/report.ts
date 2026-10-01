import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SuiteResult {
  suite: string;
  iterations: number;
  failed?: string;
  targets: { name: string; ops: Record<string, {
    median?: number; min?: number; samples?: number | number[]; score?: number;
  }>; meta?: Record<string, unknown> }[];
}
export function writeReport(output: string, metadata: Record<string, unknown>, suites: SuiteResult[]): void {
  writeFileSync(resolve(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ ...metadata, suites }, null, 2) + '\n');
  const lines = ['# Pinned Octane comparison', '',
    `Upstream: \`${metadata.upstreamCommit}\`. Memoized-dom: \`${metadata.memoizedCommit}\`.`, '',
    'These results supplement the existing performance backlog; they do not change its priorities.', '',
    ...(metadata.failed ? [`**Incomplete or failed run:** ${metadata.failed}`, ''] : []),
    'Timing values are median milliseconds per operation, including the framework commit. Paint is excluded.',
    'Deterministic framework work counts are kept in JSON and are not comparable timing values.', ''];
  for (const suite of suites) {
    lines.push(`## ${suite.suite}`, '', `Samples: ${suite.iterations}. ${suite.failed ? `FAILED: ${suite.failed}` : 'Harness passed.'}`, '');
    const targets = suite.targets;
    const operations = [...new Set(targets.flatMap(target => Object.keys(target.ops)))];
    lines.push(`| Operation | ${targets.map(target => target.name).join(' | ')} |`,
      `|---|${targets.map(() => '---:').join('|')}|`);
    for (const operation of operations) {
      if (/^(live_inserts_|fragment_commits_|production_calls_)/.test(operation)) continue;
      if (!targets.some(target => target.ops[operation]?.median !== undefined)) continue;
      lines.push(`| ${operation} | ${targets.map(target => {
        const value = target.ops[operation];
        return value?.median === undefined ? '—' : value.median.toFixed(3);
      }).join(' | ')} |`);
    }
    lines.push('');
    for (const target of targets) if (target.meta?.identityGate) {
      lines.push(`- ${target.name}: retained row identity ${target.meta.identityGate}.`);
    }
    lines.push('');
  }
  writeFileSync(resolve(output, 'results.md'), lines.join('\n'));
}
