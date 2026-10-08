// This test verifies actual browser behavior in Chrome or Edge.
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { expect, it } from 'bun:test';
import { compile } from '../packages/compiler/src/compile';

function chromeExecutable(): string | undefined {
  return [
    process.env.MMD_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));
}

it.skipIf(!chromeExecutable())('preserves DOM shape and custom-element creation timing in Chromium', async () => {
  const executablePath = chromeExecutable()!;
  const bundle = await build({
    entryPoints: ['packages/runtime/src/index.ts'],
    bundle: true, write: false, format: 'iife', globalName: 'MMD',
  });
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const markupBundle = await build({
      stdin: { contents: `export {walkMarkup} from './packages/runtime/src/markup-walk';
        export {parseMarkup} from './packages/runtime/src/markup-parse';`, resolveDir: process.cwd() },
      bundle: true, write: false, format: 'iife', globalName: 'Markup',
    });
    await page.addScriptTag({ content: markupBundle.outputFiles[0]!.text });
    // Use the native parser here: the DOM test shim does not implement MathML.
    const markupParity = await page.evaluate(() => {
      type Parsed = {type: string; text?: string; tag?: string; ns?: string;
        attrs?: [string,string][]; children?: Parsed[]};
      const api = (globalThis as unknown as {Markup: {
        walkMarkup(source: string, visit: (tag: string | null, ns: string) => void): void;
        parseMarkup(source: string): Parsed[];
      }}).Markup;
      return [
        '<main><svg><circle cx="5"/><path d="M0 0"></path></svg><math><mi>x</mi></math></main>',
        `<div title="a > b &amp; c" disabled><span>one &lt; two</span><img src='logo.png'/>tail</div>`,
      ].map(source => {
        const template = document.createElement('template');
        template.innerHTML = source;
        const nodes: Node[] = [];
        const collect = (parent: Node): void => {
          for (const node of parent.childNodes) { collect(node); nodes.push(node); }
        };
        collect(template.content);
        const shape: unknown[] = [];
        api.walkMarkup(source, (tag, ns) => shape.push(tag === null ? [3] : [1,tag,ns]));
        const nativeShape = nodes.map(node => node.nodeType === 3 ? [3] :
          [1,(node as Element).localName,(node as Element).namespaceURI]);
        const values: unknown[] = [];
        const flatten = (children: Parsed[]): void => {
          for (const node of children) {
            if (node.children) flatten(node.children);
            values.push(node.type === 'text' ? node.text : Object.fromEntries(node.attrs!));
          }
        };
        flatten(api.parseMarkup(source));
        const nativeValues = nodes.map(node => node.nodeType === 3 ? node.textContent :
          Object.fromEntries([...(node as Element).attributes].map(attr => [attr.name,attr.value])));
        return JSON.stringify(shape) === JSON.stringify(nativeShape) &&
          JSON.stringify(values) === JSON.stringify(nativeValues);
      });
    });
    expect(markupParity).toEqual([true, true]);
    const padding = '<span data-kind="item">item</span>'.repeat(16);
    for (const tag of ['p', 'a', 'button', 'li', 'h1', 'form', 'option', 'x-widget']) {
      const child = ['p', 'option', 'x-widget'].includes(tag) ? 'div' : tag;
      const code = compile(`export function App() {
        return <${tag}><${child}>${padding}</${child}></${tag}>;
      }`).replace(/^import \* as _MD from .*;$/m, '')
        .replace(/export function /g, 'function ');
      const result = await page.evaluate(({ code, tag }) => {
        const mmd = (globalThis as unknown as {
          MMD: { unregisterSubtree(id: string): void };
        }).MMD;
        let constructed = 0;
        if (tag === 'x-widget') {
          customElements.define(tag, class extends HTMLElement {
            constructor() { super(); constructed++; }
          });
        }
        const app = new Function('_MD', code + '\nreturn App;')(mmd);
        const root = app('App', null) as Element;
        const result = {
          tag: root.localName,
          child: (root.firstChild as Element).localName,
          spans: root.querySelectorAll('span').length,
          constructed,
        };
        mmd.unregisterSubtree('App');
        return result;
      }, { code, tag });
      expect(result).toEqual({ tag, child, spans: 16, constructed: tag === 'x-widget' ? 1 : 0 });
    }
    const code = compile(`export function App() {
      return <div is="x-built-in">${padding}</div>;
    }`).replace(/^import \* as _MD from .*;$/m, '')
      .replace(/export function /g, 'function ');
    const constructed = await page.evaluate(code => {
      const mmd = (globalThis as unknown as {
        MMD: { unregisterSubtree(id: string): void };
      }).MMD;
      let constructed = 0;
      customElements.define('x-built-in', class extends HTMLDivElement {
        constructor() { super(); constructed++; }
      }, { extends: 'div' });
      const app = new Function('_MD', code + '\nreturn App;')(mmd);
      const root = app('App', null) as Element;
      document.body.appendChild(root);
      root.remove();
      mmd.unregisterSubtree('App');
      return constructed;
    }, code);
    expect(constructed).toBe(0);
  } finally {
    await browser.close();
  }
}, 60_000);
