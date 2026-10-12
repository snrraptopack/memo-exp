import { expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  childNode,
  type BaseNode,
  parseEstreeOrThrow,
  stringValue,
  walkAst,
} from '../packages/compiler/src/ast';
import { createAnalysisCtx, type Ctx } from '../packages/compiler/src/context/model';
import { refreshAstAnalysis } from '../packages/compiler/src/context';
import { analyzeComponent } from '../packages/compiler/src/analysis/component-validation';
import { prepareSemanticAnalysis } from '../packages/compiler/src/analysis/pipeline';
import { planCompilerIntrinsics } from '../packages/compiler/src/intrinsics';
import type { ManifestAnalysisAdapter } from '../packages/compiler/src/linking/discovery';
import {
  createProjectEntries,
  discoverProject,
  linkManifestWorklist,
  resolveApplicationRoot,
} from '../packages/compiler/src/linking/project';
import { domManifestAnalysis, prepareDomProjectEntry } from '../packages/compiler/src/dom/project';
import type { CompileModulesOptions } from '../packages/compiler/src/linking/model';

const sourceAdapter: ManifestAnalysisAdapter<Ctx> = {
  createContext: createAnalysisCtx,
  prepare(context, path) {
    prepareSemanticAnalysis(context, path, {
      install(context, path) {
        refreshAstAnalysis(context, path.node);
        planCompilerIntrinsics(context, path);
      },
      validateComponents(context) {
        for (const component of context.comps.keys()) {
          analyzeComponent(context, component);
        }
      },
    });
  },
  // Source-only analysis does not publish a target's lifetime optimization.
  listResourceFree: () => false,
  // These fixtures have no route preparations or target route lowering.
  routedPreparations: () => [],
};

const linkedSources = {
  './main.ts': `
    import { mount } from '@memoized-dom/runtime';
    import { View } from './components';

    const handle = mount('root', View);
    export { handle };
  `,
  './App.tsx': `
    import { value, increment } from './actions';

    export function App() {
      return <button onClick={increment}>{value}</button>;
    }
  `,
  './components.ts': `
    import { App } from './App';
    export { App as View };
  `,
  './actions.ts': `
    import { count, increment } from './state';
    export { count as value, increment };
  `,
  './state.ts': `
    export let count = 0;

    export function increment() {
      count++;
    }
  `,
};

it('shares canonical cells, helper writes and mount discovery across target preparation', () => {
  const contexts: Ctx[] = [];
  const adapter = {
    ...sourceAdapter,
    createContext(options: Parameters<typeof createAnalysisCtx>[0]) {
      const context = createAnalysisCtx(options);
      contexts.push(context);
      return context;
    },
  };

  // Importers precede their defining modules. Reverse the order too so a
  // lucky traversal order cannot hide missing fixed-point propagation.
  for (const sources of [linkedSources, Object.fromEntries(Object.entries(linkedSources).reverse())]) {
    const entries = createProjectEntries(sources, {}, () => {});
    const initial = discoverProject(entries, {});
    const root = resolveApplicationRoot(entries, initial, {})!;
    const native = linkManifestWorklist(entries, initial, {}, root.rootId, [], adapter);

    const domEntries = createProjectEntries(sources, {}, prepareDomProjectEntry);
    const dom = linkManifestWorklist(
      domEntries, discoverProject(domEntries, {}), {}, root.rootId, [], domManifestAnalysis,
    );

    expect(root).toEqual({
      key: './App.tsx#App',
      moduleId: './App.tsx',
      mountModuleId: './main.ts',
      local: 'App',
      rootId: 'App',
    });
    expect(resolveApplicationRoot(entries, native, {})).toEqual(root);
    expect(native.get('./actions.ts')!.exports.value).toEqual(dom.get('./actions.ts')!.exports.value);
    expect(native.get('./actions.ts')!.exports.value).toMatchObject({
      type: 'state', key: './state.ts#count', kind: 'let',
    });
    expect(native.get('./actions.ts')!.exports.increment).toMatchObject({
      type: 'function', writes: ['./state.ts#count'], unbounded: false,
    });
    expect(native.get('./App.tsx')!.readers).toEqual(dom.get('./App.tsx')!.readers);
    expect(native.get('./App.tsx')!.readers['./state.ts#count']).toContain('App');
    expect(native.get('./components.ts')!.exports.View).not.toHaveProperty('listResourceFree');
  }

  expect(contexts.length).toBeGreaterThan(Object.keys(linkedSources).length);
  for (const context of contexts) {
    expect(context).not.toHaveProperty('emission');
    expect(context).not.toHaveProperty('instanceReasonIds');
  }
});

it('uses host resolution for shared graph identities without changing original output IDs', () => {
  const options: CompileModulesOptions = {
    resolveImport(specifier) {
      return specifier === 'app-state' ? './lib/state.ts' : undefined;
    },
  };
  const entries = createProjectEntries({
    '.\\lib\\state.ts': `
      export let count = 0;
      export function increment() { count++; }
    `,
    './App.tsx': `
      import { count, increment } from 'app-state';
      export function App() { return <button onClick={increment}>{count}</button>; }
    `,
  }, options, () => {});
  const manifests = linkManifestWorklist(
    entries, discoverProject(entries, options), options, 'App', [], sourceAdapter,
  );

  expect(entries.get('./lib/state.ts')!.originalId).toBe('.\\lib\\state.ts');
  expect(manifests.get('./App.tsx')!.readers['./lib/state.ts#count']).toEqual(['App']);
  expect(() => createProjectEntries({
    './state.ts': 'export let count = 0;',
    '.\\state.ts': 'export let other = 1;',
  }, {}, () => {})).toThrow("duplicate module id after normalization: './state.ts'");
});

it('retains frontend CSS and comments and prepares entries before identity discovery', () => {
  const prepared: string[] = [];
  const entries = createProjectEntries({ './view.tsx': '// authored comment\nexport let count = 0;' }, {
    frontend: {
      name: 'project-css-contract',
      parse(source, options) {
        return { ...parseEstreeOrThrow(source, options), css: '.view { color: red; }' };
      },
    },
  }, entry => {
    prepared.push(entry.id);
    // A target may install provider imports or normalize a declaration here.
    const declaration = entry.ast.body[0];
    if (declaration?.type === 'ExportNamedDeclaration' && declaration.declaration?.type === 'VariableDeclaration') {
      const binding = declaration.declaration.declarations[0]!.id;
      if (binding.type === 'Identifier') binding.name = 'installed';
    }
  });

  const entry = entries.get('./view.tsx')!;
  expect(prepared).toEqual(['./view.tsx']);
  expect(entry.css).toBe('.view { color: red; }');
  expect(entry.comments?.[0]?.value).toContain('authored comment');
  expect(discoverProject(entries, {}).get('./view.tsx')!.exports.installed).toMatchObject({
    type: 'state', key: './view.tsx#installed',
  });
});

it('retains the single mount guard and explicit multi-root diagnostic mode', () => {
  const entries = createProjectEntries({
    './App.tsx': 'export function App() { return <p>hello</p>; }',
    './one.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';

      mount('one', App);
    `,
    './two.ts': `
      import { mount } from '@memoized-dom/runtime';
      import { App } from './App';

      mount('two', App);
    `,
  }, {}, () => {});
  const initial = discoverProject(entries, {});

  expect(() => resolveApplicationRoot(entries, initial, {})).toThrow('only one top-level mount()');
  expect(resolveApplicationRoot(entries, initial, {}, false)).toBeUndefined();
});

it('bounds fixed-point work when an adapter publishes nonconverging facts', () => {
  const entries = createProjectEntries({
    './loop.ts': `
      import { count as previous } from './loop';
      export let count = 0;
    `,
  }, {}, () => {});
  let analyses = 0;

  expect(() => linkManifestWorklist(entries, discoverProject(entries, {}), {}, 'App', [], {
    ...sourceAdapter,
    prepare(context, path) {
      sourceAdapter.prepare(context, path);
      context.state.set('count', ++analyses % 2 === 0 ? 'const' : 'let');
    },
  })).toThrow('export summaries did not converge');
});

it('shared project execution has no transitive DOM or runtime value dependency', () => {
  const sourceRoot = resolve(import.meta.dirname, '../packages/compiler/src');
  const pending = [join(sourceRoot, 'linking/project.ts')];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const program = parseEstreeOrThrow(readFileSync(file, 'utf8'), { filename: file }).program;

    walkAst<BaseNode>(program, {
      enter(node) {
        if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportAllDeclaration') return;
        // The public project option types still describe browser initial content.
        // Type-only edges cannot load a DOM allocator or emission at execution.
        const fields = node as unknown as {
          importKind?: string;
          exportKind?: string;
          specifiers?: { importKind?: string; exportKind?: string }[];
        };
        if (fields.importKind === 'type' || fields.exportKind === 'type') return;
        if (fields.specifiers?.length && fields.specifiers.every(specifier =>
          specifier.importKind === 'type' || specifier.exportKind === 'type')) return;
        const specifier = stringValue(childNode(node, 'source'));
        if (specifier === null) return;
        const target = specifier.startsWith('.') ? resolve(dirname(file), specifier) : specifier;
        const name = relative(sourceRoot, target).replaceAll('\\', '/');

        if (/^(dom|emission)(\/|$)/.test(name) || /^@memoized-dom\/runtime(?:\/|$)/.test(specifier)) {
          violations.push(`${relative(sourceRoot, file)} -> ${specifier}`);
        } else if (specifier.startsWith('.')) {
          const dependency = [`${target}.ts`, join(target, 'index.ts')].find(existsSync);
          if (dependency) pending.push(dependency);
        }
      },
    });
  }

  expect(violations).toEqual([]);
});
