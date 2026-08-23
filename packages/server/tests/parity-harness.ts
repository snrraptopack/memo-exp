/**
 * Shared CSR-equivalence harness (Phase 1.5).
 *
 * Compiles one authored source, instantiates it as TWO separate module
 * records (server tier + client tier - compiled template caches capture the
 * first-creation document), renders each through its tier, and normalizes
 * declared-irrelevant serializer details before comparison:
 *   - runtime comment anchors (when:/list:)
 *   - attribute order within a tag
 *   - whitespace runs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import type { ApplicationRuntime } from '@memoized-dom/runtime';
import { renderWithDom, syncBooleanAttributes } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures', 'out');

export interface CompiledTiers {
  serverModule: any;
  clientModule: any;
}

export async function compileFixture(
  name: string,
  source: string,
): Promise<CompiledTiers> {
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `${name}.compiled.ts`);
  const output = compileModules(
    { [`./${name}.tsx`]: source },
    { runtimePath: '@memoized-dom/runtime' },
  );
  const compiled = output[`./${name}.tsx`]!;
  writeFileSync(outputPath, compiled);
  // Distinct module records per tier - see ssr.md slice 1.4 finding #1.
  // The compiled output may retain authored TypeScript annotations, so both
  // records must keep a .ts extension for the test transform pipeline.
  const clientPath = join(outDir, `${name}.client.ts`);
  writeFileSync(clientPath, compiled);

  const [serverModule, clientModule] = await Promise.all([
    import(pathToFileURL(outputPath).href),
    import(pathToFileURL(clientPath).href),
  ]);
  return { serverModule, clientModule };
}

/**
 * Normalize declared-irrelevant serializer details so only semantic
 * structure is compared:
 *   - runtime comment anchors (when:/list: region markers)
 *   - attribute order within a tag
 *   - boolean/empty attribute form (`checked` vs `checked=""`)
 *   - empty foreign-element form (`<circle />` vs `<circle></circle>`)
 *   - whitespace runs
 */
export function normalizeHtml(html: string): string {
  return (
    html
      .replace(/<!--.*?-->/g, '')
      // Serializers only ever self-close foreign (SVG) elements, whose
      // counterpart form elsewhere is an explicit empty pair, so expanding
      // is loss-free for every input the tiers can produce.
      .replace(
        /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s/>=]+(?:="[^"]*")?)*)\s*\/>/g,
        '<$1$2></$1>',
      )
      .replace(
        /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s/>=]+(?:="[^"]*")?)*)\s*>/g,
        (_match, tag: string, attrs: string) => {
          const canonical = (
            attrs.match(/[^\s/>=]+(?:="[^"]*")?/g) ?? []
          )
            .map((attribute) => {
              const eq = attribute.indexOf('="');
              if (eq === -1) return attribute;
              const name = attribute.slice(0, eq);
              let value = attribute.slice(eq + 2, -1);
              if (name === 'style') {
                // happy-dom appends a serialization semicolon.
                value = value.replace(/;+$/, '');
              }
              // LinkeDOM leaves bare '&' unescaped in attribute values;
              // ambiguous ampersands parse literally, so canonicalize both
              // spellings to the escaped form for comparison.
              value = value.replace(
                /&(?!(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g,
                '&amp;',
              );
              // `checked` and `checked=""` are the same DOM state.
              return value === '' ? name : `${name}="${value}"`;
            })
            .sort()
            .join(' ');
          return `<${tag.toLowerCase()}${canonical ? ' ' + canonical : ''}>`;
        },
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export interface ParityResult {
  serverHtml: string;
  clientHtml: string;
  serverNodes: readonly Node[];
  serverDocument: Document;
  serverRuntime: ApplicationRuntime;
  clientRoot: Element;
}

/**
 * Render the fixture through both tiers. The caller must dispose
 * `result.serverRuntime` when finished inspecting the server document.
 */
export function renderBothTiers(
  tiers: CompiledTiers,
  entry = 'App',
): ParityResult {
  const rendered = renderWithDom(tiers.serverModule[entry]);
  const clientRoot = tiers.clientModule[entry](
    `${entry}Client`,
    null,
  ) as Element;

  // Both tiers set compiled boolean attributes as properties; some DOM
  // implementations serialize only attributes. Apply the same property →
  // attribute sync the server renderer applies so both sides expose the
  // same semantic state before serialization.
  syncBooleanAttributes(clientRoot);
  const clientHtml =
    clientRoot.nodeType === 11
      ? Array.from(clientRoot.childNodes)
          .map((node) => (node as Element).outerHTML ?? '')
          .join('')
      : (clientRoot as Element).outerHTML;

  return {
    serverHtml: rendered.html,
    clientHtml,
    serverNodes: rendered.nodes,
    serverDocument: rendered.document,
    serverRuntime: rendered.runtime,
    clientRoot,
  };
}

/** Assert structural parity between the two tiers. */
export function expectParity(result: ParityResult): void {
  expect(normalizeHtml(result.serverHtml)).toBe(
    normalizeHtml(result.clientHtml),
  );
}
