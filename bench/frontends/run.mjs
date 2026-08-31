import { parseSync as parseBabel } from '@babel/core';
import { parseSync as parseOxc } from 'oxc-parser';
import { parse as parseYuku } from 'yuku-parser';
import { performance } from 'node:perf_hooks';

const component = (index) => `
  interface Item${index} { id: number; label: string }
  export function View${index}({ title }: { title: string }) {
    let items: Item${index}[] = [{ id: ${index}, label: title }];
    return <section data-view={${index}}>
      <button onClick={() => items.push({ id: items.length, label: title })}>
        {title}
      </button>
      <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
    </section>;
  }
`;

const source = Array.from({ length: 80 }, (_, index) => component(index)).join('\n');
const iterations = 250;
const rounds = 7;

const frontends = [
  {
    name: 'yuku',
    parse() {
      return parseYuku(source, {
        lang: 'tsx',
        sourceType: 'module',
        preserveParens: false,
      }).program;
    },
  },
  {
    name: 'oxc',
    parse() {
      return parseOxc('bench.tsx', source, {
        lang: 'tsx',
        sourceType: 'module',
        astType: 'ts',
        range: false,
        preserveParens: false,
      }).program;
    },
  },
  {
    name: 'babel',
    parse() {
      return parseBabel(source, {
        filename: 'bench.tsx',
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: ['jsx', 'typescript'] },
      });
    },
  },
];

for (const frontend of frontends) {
  for (let index = 0; index < 20; index++) frontend.parse();
}

const results = frontends.map((frontend) => {
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) frontend.parse();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  const elapsed = samples[Math.floor(samples.length / 2)];
  return {
    frontend: frontend.name,
    milliseconds: elapsed,
    parsesPerSecond: iterations / (elapsed / 1000),
  };
});

const fastest = Math.min(...results.map((result) => result.milliseconds));
console.table(
  results.map((result) => ({
    frontend: result.frontend,
    'median ms': result.milliseconds.toFixed(2),
    'parses/sec': result.parsesPerSecond.toFixed(1),
    relative: `${(result.milliseconds / fastest).toFixed(2)}x`,
  })),
);
