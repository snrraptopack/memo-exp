import { compile } from '../../compiler/compile';
import { compileModules } from '../../compiler/linker';

interface Row {
  modules: number;
  bytes: number;
  prelinkedMs: number;
  linkedMs: number;
  linkedPerModuleMs: number;
  overhead: number;
}

function graph(pairs: number): Record<string, string> {
  const modules: Record<string, string> = {};
  for (let i = 0; i < pairs; i++) {
    modules[`./src/state-${i}.ts`] = `
      export let value = ${i};
      export const doubled = value * 2;
      export function bump() { value++; }
    `;
    modules[`./src/view-${i}.tsx`] = `
      import { value, doubled, bump } from '@/state-${i}';
      export function View${i}() {
        return <button onClick={() => bump()}>{value}:{doubled}</button>;
      }
    `;
  }
  return modules;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function time(operation: () => void): number {
  const start = performance.now();
  operation();
  return performance.now() - start;
}

function measure(modules: Record<string, string>): Row {
  const prelinked = (): void => {
    for (const [moduleId, source] of Object.entries(modules)) {
      const match = /^\.\/src\/view-(\d+)\.tsx$/.exec(moduleId);
      if (match === null) {
        compile(source, { moduleId });
        continue;
      }
      const stateId = `./src/state-${match[1]}.ts`;
      compile(source, {
        moduleId,
        linkedImports: {
          value: { type: 'state', kind: 'let', key: `${stateId}#value` },
          doubled: { type: 'state', kind: 'computed', key: `${stateId}#doubled` },
          bump: {
            type: 'function',
            reads: [`${stateId}#value`],
            writes: [`${stateId}#value`],
            opaque: false,
          },
        },
      });
    }
  };
  const linked = (): void => {
    compileModules(modules, { aliases: { '@': './src' } });
  };

  prelinked();
  linked();

  const prelinkedSamples: number[] = [];
  const linkedSamples: number[] = [];
  for (let i = 0; i < 7; i++) {
    // Alternate order to reduce systematic temperature/JIT bias.
    if ((i & 1) === 0) {
      prelinkedSamples.push(time(prelinked));
      linkedSamples.push(time(linked));
    } else {
      linkedSamples.push(time(linked));
      prelinkedSamples.push(time(prelinked));
    }
  }

  const prelinkedMs = median(prelinkedSamples);
  const linkedMs = median(linkedSamples);
  return {
    modules: Object.keys(modules).length,
    bytes: Object.values(modules).reduce((sum, source) => sum + source.length, 0),
    prelinkedMs,
    linkedMs,
    linkedPerModuleMs: linkedMs / Object.keys(modules).length,
    overhead: linkedMs / prelinkedMs,
  };
}

const rows = [1, 4, 8].map((pairs) => measure(graph(pairs)));

console.log('\nCROSS-MODULE LINKER (Bun, median of 7)\n');
console.log(
  'modules'.padStart(8),
  'source'.padStart(10),
  'prelinked'.padStart(14),
  'linked'.padStart(12),
  'linked/mod'.padStart(12),
  'overhead'.padStart(10),
);
console.log('-'.repeat(72));
for (const row of rows) {
  console.log(
    String(row.modules).padStart(8),
    `${(row.bytes / 1024).toFixed(1)}KiB`.padStart(10),
    `${row.prelinkedMs.toFixed(1)}ms`.padStart(14),
    `${row.linkedMs.toFixed(1)}ms`.padStart(12),
    `${row.linkedPerModuleMs.toFixed(1)}ms`.padStart(12),
    `${row.overhead.toFixed(2)}x`.padStart(10),
  );
}
console.log('\nPrelinked transforms receive the same canonical import metadata directly.');
