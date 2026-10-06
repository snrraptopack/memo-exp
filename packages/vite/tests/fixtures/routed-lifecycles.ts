import { expect } from 'vitest';
import type { Page } from 'puppeteer-core';

declare global {
  interface Window {
    __routeClock: number;
    __routeEvents: string[];
    __routeReads: number;
    __initialInput?: Element;
  }
}

// Stable authored sources shared by development and production integration checks.
export const routedApp = `import {Group} from '@memoized-dom/data';import {Detail} from './Detail';
  function Pending(){return <p>Loading</p>;}
  export function App(){const user=$fetch('/api/user');return <main route="/">
    <nav><a class="home" route-to="/demo/">Home</a><a class="detail" route-to="/demo/detail">Detail</a></nav>
    <section route="/demo/"><Group pending={Pending}><h1>{user?.name}</h1></Group></section>
    <Detail route="/demo/detail"/></main>;}`;

export const routedDetail = `import {clock,record} from './opaque.mjs';
  export function Detail(){let count=0;let input;
    $effect(()=>{record('effect:'+count);return()=>record('effect-cleanup');});
    return <section class="detail-view"><input ref={[input,node=>{
      record('ref');return()=>record('ref-cleanup');}]} value={count}/>
      <button class="increment" onClick={()=>{count++;input.setAttribute('data-bound','yes');}}>Increment</button>
      <output>{count}</output><p class="clock">{clock.value}</p></section>;}`;

export const routedOpaque = `export const clock={get value(){
    globalThis.__routeReads=(globalThis.__routeReads??0)+1;return globalThis.__routeClock ?? 10;}};
  export function record(value){globalThis.__routeEvents?.push(value);}`;

export async function initializeRoutedLifecycles(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    const realm = window;
    realm.__routeClock = 10;
    realm.__routeEvents = [];
    realm.__routeReads = 0;
    new MutationObserver(() => {
      realm.__initialInput ??= document.querySelector('input') ?? undefined;
    }).observe(document, { subtree: true, childList: true });
  });
}

export async function checkRoutedLifecycles(page: Page): Promise<void> {
  await page.waitForSelector('.detail-view input');
  await page.waitForFunction(() => window.__routeEvents.includes('effect:0'));
  expect(await page.evaluate(() => document.querySelector('input') === window.__initialInput)).toBe(true);
  expect(await page.evaluate(() => window.__routeEvents.filter(entry => entry === 'ref').length)).toBe(1);
  await page.click('.increment');
  await page.waitForFunction(() => document.querySelector('output')?.textContent === '1'
    && window.__routeEvents.includes('effect:1'));
  expect(await page.$eval('input', node => [node.value, node.getAttribute('data-bound')])).toEqual(['1', 'yes']);
  await page.evaluate(() => { window.__routeClock = 23; });
  await page.waitForFunction(() => document.querySelector('.clock')?.textContent === '23');
  await page.click('.home');
  await page.waitForSelector('h1');
  expect(await page.$eval('h1', node => node.textContent)).toBe('Ada');
  expect(await page.$('.detail-view')).toBeNull();
  expect(await page.evaluate(() => window.__routeEvents.filter(entry => entry === 'ref-cleanup').length)).toBe(1);
  expect(await page.evaluate(() => window.__routeEvents.filter(entry => entry === 'effect-cleanup').length)).toBe(2);
  const events = await page.evaluate(() => window.__routeEvents.length);
  const reads = await page.evaluate(() => window.__routeReads);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.__routeEvents.length)).toBe(events);
  expect(await page.evaluate(() => window.__routeReads)).toBe(reads);
  await page.click('.detail');
  await page.waitForFunction(() => document.querySelector('output')?.textContent === '0');
  expect(await page.$eval('.clock', node => node.textContent)).toBe('23');
  expect(await page.evaluate(() => window.__routeEvents.filter(entry => entry === 'ref').length)).toBe(2);
}
