export interface OracleScenario {
  name: string;
  moduleId: string;
  exportedMutation: string;
  arguments?: unknown[];
}

export interface OracleCase {
  name: string;
  category: string;
  modules: Record<string, string>;
  scenarios: OracleScenario[];
}

export const oracleCases: OracleCase[] = [
  {
    name: 'aliased-import',
    category: 'aliasing',
    modules: {
      './state.ts': `
        export const model = { count: 1 };
        export function increment(): void { model.count++; }
        export function decrement(): void { model.count--; }
        export function reset(): void { model.count = 0; }
      `,
      './derived.ts': `
        import { model as current } from './state';
        export const doubled = current.count * 2;
      `,
    },
    scenarios: [
      { name: 'increment through exported mutator', moduleId: './state.ts', exportedMutation: 'increment' },
      { name: 'decrement through the same alias', moduleId: './state.ts', exportedMutation: 'decrement' },
      { name: 'exact reset through defining export', moduleId: './state.ts', exportedMutation: 'reset' },
    ],
  },
  {
    name: 'helper-depth-four',
    category: 'helper depth',
    modules: {
      './state.ts': `
        export const model = { value: 0 };
        export function leaf(target: { value: number }): void { target.value++; }
        export function layer1(target: { value: number }): void { leaf(target); }
        export function layer2(target: { value: number }): void { layer1(target); }
        export function layer3(target: { value: number }): void { layer2(target); }
        export function increment(): void { layer3(model); }
        export function decrementLeaf(target: { value: number }): void { target.value--; }
        export function decrement(): void { decrementLeaf(model); }
      `,
      './derived.ts': `
        import { model } from './state';
        export const display = 'value:' + model.value;
      `,
    },
    scenarios: [
      { name: 'four-level parameter-relative chain', moduleId: './state.ts', exportedMutation: 'increment' },
      { name: 'repeat four-level chain', moduleId: './state.ts', exportedMutation: 'increment' },
      { name: 'second parameter-relative leaf', moduleId: './state.ts', exportedMutation: 'decrement' },
    ],
  },
  {
    name: 'conditional-branch',
    category: 'branching',
    modules: {
      './state.ts': `
        export let primaryMode = true;
        export let primary = 1;
        export let secondary = 10;
        export function bumpPrimary(): void { primary++; }
        export function bumpSecondary(): void { secondary++; }
        export function toggle(): void { primaryMode = !primaryMode; }
      `,
      './derived.ts': `
        import { primary, primaryMode, secondary } from './state';
        export const selected = primaryMode ? primary : secondary;
      `,
    },
    scenarios: [
      { name: 'inactive branch write', moduleId: './state.ts', exportedMutation: 'bumpSecondary' },
      { name: 'active primary branch write', moduleId: './state.ts', exportedMutation: 'bumpPrimary' },
      { name: 'switch active branch', moduleId: './state.ts', exportedMutation: 'toggle' },
      { name: 'now-inactive primary write', moduleId: './state.ts', exportedMutation: 'bumpPrimary' },
      { name: 'new active branch write', moduleId: './state.ts', exportedMutation: 'bumpSecondary' },
      { name: 'switch back to primary', moduleId: './state.ts', exportedMutation: 'toggle' },
    ],
  },
  {
    name: 'cross-module-derived-chain',
    category: 'multi-file derivation',
    modules: {
      './state.ts': `
        export let value = 2;
        export function increment(): void { value++; }
        export function decrement(): void { value--; }
      `,
      './derived.ts': `
        import { value } from './state';
        export const doubled = value * 2;
      `,
      './derived2.ts': `
        import { doubled } from './derived';
        export const label = 'total:' + doubled;
      `,
    },
    scenarios: [
      { name: 'propagate through two files', moduleId: './state.ts', exportedMutation: 'increment' },
      { name: 'repeat two-file propagation', moduleId: './state.ts', exportedMutation: 'increment' },
      { name: 'reverse two-file propagation', moduleId: './state.ts', exportedMutation: 'decrement' },
    ],
  },
  {
    name: 'independent-object-fields',
    category: 'path precision',
    modules: {
      './state.ts': `
        export const model = { left: 1, right: 10 };
        export function bumpLeft(): void { model.left++; }
        export function bumpRight(): void { model.right++; }
      `,
      './left.ts': `
        import { model } from './state';
        export const leftLabel = 'L' + model.left;
      `,
      './right.ts': `
        import { model } from './state';
        export const rightLabel = 'R' + model.right;
      `,
      './sum.ts': `
        import { model } from './state';
        export const sum = model.left + model.right;
      `,
    },
    scenarios: [
      { name: 'left path first write', moduleId: './state.ts', exportedMutation: 'bumpLeft' },
      { name: 'right path first write', moduleId: './state.ts', exportedMutation: 'bumpRight' },
      { name: 'left path repeated write', moduleId: './state.ts', exportedMutation: 'bumpLeft' },
      { name: 'right path repeated write', moduleId: './state.ts', exportedMutation: 'bumpRight' },
    ],
  },
  {
    name: 'multiple-import-aliases',
    category: 'aliasing',
    modules: {
      './state.ts': `
        export const pair = { first: 2, second: 5 };
        export function bumpFirst(): void { pair.first++; }
        export function bumpSecond(): void { pair.second++; }
      `,
      './first.ts': `
        import { pair as source } from './state';
        export const firstSquared = source.first * source.first;
      `,
      './second.ts': `
        import { pair as values } from './state';
        export const secondSquared = values.second * values.second;
      `,
      './combined.ts': `
        import { firstSquared as a } from './first';
        import { secondSquared as b } from './second';
        export const combined = a + b;
      `,
    },
    scenarios: [
      { name: 'first alias chain', moduleId: './state.ts', exportedMutation: 'bumpFirst' },
      { name: 'second alias chain', moduleId: './state.ts', exportedMutation: 'bumpSecond' },
      { name: 'first alias chain repeated', moduleId: './state.ts', exportedMutation: 'bumpFirst' },
    ],
  },
  {
    name: 'collection-receiver',
    category: 'receiver mutation',
    modules: {
      './state.ts': `
        export const bag = { items: [1, 2] as number[] };
        export function append(): void { bag.items.push(3); }
        export function removeFirst(): void { bag.items.shift(); }
        export function replaceMiddle(): void { bag.items.splice(0, 1, 9); }
      `,
      './derived.ts': `
        import { bag } from './state';
        export const size = bag.items.length;
        export const first = bag.items[0] ?? -1;
      `,
    },
    scenarios: [
      { name: 'array push receiver', moduleId: './state.ts', exportedMutation: 'append' },
      { name: 'array shift receiver', moduleId: './state.ts', exportedMutation: 'removeFirst' },
      { name: 'array splice receiver', moduleId: './state.ts', exportedMutation: 'replaceMiddle' },
    ],
  },
];
