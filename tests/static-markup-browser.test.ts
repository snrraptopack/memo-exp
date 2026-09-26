// @vitest-environment node
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { expect, it } from 'vitest';
import { compile } from '../packages/compiler/src/compile';

it('preserves DOM shape and custom-element creation timing in Chromium', async context => {
  const executablePath = [
    process.env.MMD_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((candidate): candidate is string => candidate !== undefined && existsSync(candidate));
  if (executablePath === undefined) {
    context.skip('Chromium is unavailable; set MMD_CHROME_PATH to run this test');
    return;
  }
  const bundle = await build({
    entryPoints: ['packages/runtime/src/index.ts'],
    bundle: true, write: false, format: 'iife', globalName: 'MMD',
  });
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
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
