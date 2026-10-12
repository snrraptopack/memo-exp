/** Compare checked-in fixtures and project products against a pre-change compiler. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { compileDetailed, compileModulesDetailed, type CompiledSource } from '../packages/compiler/src/index';

interface FixtureCase {
  moduleId: string;
  initialContent: boolean;
  sourceHash: string;
  output?: CompiledSource;
  diagnostic?: string;
}

interface CompilerBaseline {
  baseline: string;
  records: FixtureCase[];
}

interface ProjectObservation {
  output?: unknown;
  diagnostic?: string;
}

function hash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function observe(moduleId: string, initialContent: boolean): FixtureCase {
  const source = readFileSync(resolve(moduleId), 'utf8');
  const identity = { moduleId, initialContent, sourceHash: hash(source) };

  try {
    // The earlier capture duplicated single-module cases under this label.
    // initialContent applies only to project compilation; keep compatibility
    // with that capture while project-mode comparison is performed separately.
    return { ...identity, output: compileDetailed(source, { moduleId }) };
  } catch (error) {
    // Invalid fixtures are part of the contract: compare their authored
    // diagnostic too, rather than silently omitting compilation failures.
    return { ...identity, diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

function checkedInFixtures(): string[] {
  const tracked = Bun.spawnSync(['git', 'ls-files', '--', 'tests/fixtures']);

  if (tracked.exitCode !== 0) {
    throw new Error('Could not enumerate checked-in compiler fixtures');
  }

  return tracked.stdout.toString().trim().split('\n')
    .filter(path => /\.tsx?$/.test(path))
    .sort()
    .map(path => './' + path.replaceAll('\\', '/'));
}

function projectResult(
  compiler: typeof compileModulesDetailed,
  sources: Record<string, string>,
  initialContent: boolean,
): ProjectObservation {
  try {
    // The comparison is over the serializable public compiler product.
    return JSON.parse(JSON.stringify({ output: compiler(sources, { initialContent }) }));
  } catch (error) {
    return { diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

const [mode, filename] = process.argv.slice(2);

if (!['verify', 'compare-ref'].includes(mode ?? '') || !filename) {
  throw new Error('Usage: bun run test-support/compiler-output-parity.ts verify|compare-ref <file>');
}

if (mode === 'compare-ref') {
  const reference = await import(pathToFileURL(resolve(filename)).href) as {
    compileModulesDetailed: typeof compileModulesDetailed;
  };
  const cases = checkedInFixtures().map(moduleId => ({
    name: moduleId,
    sources: { [moduleId]: readFileSync(resolve(moduleId), 'utf8') },
  }));
  cases.push({
    name: 'linked-state-and-barrel',
    sources: {
      './state.ts': `
        export let count = 0;

        export function increment() {
          count++;
        }
      `,
      './barrel.ts': `
        import { count, increment } from './state';
        export { count, increment };
      `,
      './App.tsx': `
        import { count, increment } from './barrel';

        export function App() {
          return <button onClick={increment}>{count}</button>;
        }
      `,
    },
  });
  cases.push({
    name: 'mount-and-keyed-component',
    sources: {
      './main.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { App } from './App';

        mount('root', App);
      `,
      './Row.tsx': `
        export function Row({ item }) {
          let local = 0;

          return (
            <li>
              <button onClick={() => local++}>{item.title}:{local}</button>
            </li>
          );
        }
      `,
      './App.tsx': `
        import { Row } from './Row';

        export function App() {
          let items = [{ id: 1, title: 'one' }];

          return (
            <ul>
              {items.map(item => <Row key={item.id} item={item} />)}
            </ul>
          );
        }
      `,
    },
  });

  let emitted = 0;
  let diagnostics = 0;

  for (const fixture of cases) {
    for (const initialContent of [false, true]) {
      const before = projectResult(reference.compileModulesDetailed, fixture.sources, initialContent);
      const after = projectResult(compileModulesDetailed, fixture.sources, initialContent);

      if (!fixture.name.startsWith('./') && before.diagnostic) {
        throw new Error(`Valid linked fixture did not compile: ${fixture.name}\n${before.diagnostic}`);
      }

      if (!isDeepStrictEqual(before, after)) {
        throw new Error(`Project output changed: ${fixture.name} (initialContent=${initialContent})`);
      }

      if (before.diagnostic) diagnostics++;
      else emitted++;
    }
  }

  console.log(`All ${cases.length * 2} project cases match the pre-change compiler (${emitted} outputs, ${diagnostics} diagnostics)`);
} else {
  const baseline = JSON.parse(readFileSync(filename, 'utf8')) as CompilerBaseline;
  const current = checkedInFixtures();
  const captured = [...new Set(baseline.records.map(record => record.moduleId))].sort();

  if (!isDeepStrictEqual(current, captured)) {
    throw new Error('Checked-in fixture set changed; do not compare a partial corpus');
  }

  const differences: string[] = [];

  for (const before of baseline.records) {
    const after = observe(before.moduleId, before.initialContent);

    if (!isDeepStrictEqual(before, after)) {
      differences.push(`${before.moduleId} (initialContent=${before.initialContent})`);
    }
  }

  if (differences.length) {
    throw new Error(`Compiler output or diagnostic changed:\n${differences.join('\n')}`);
  }

  console.log(`All ${baseline.records.length} compiler cases match ${baseline.baseline}`);
}
