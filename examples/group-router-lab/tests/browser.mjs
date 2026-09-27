import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const executablePath = [
  process.env.MMD_BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path !== undefined && existsSync(path));
assert.ok(executablePath, 'Set MMD_BROWSER_PATH to an installed Chrome/Chromium executable.');

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address !== null && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const visit = path => page.goto(origin + path, { waitUntil: 'domcontentloaded' });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  await visit('/progressive/first');
  await page.waitForSelector('[data-board="progressive"]');
  assert.equal((await page.$$('.card-row')).length, 3);
  assert.ok((await page.$$('.row-pending')).length > 0);
  await page.type('input', 'Keep my draft');
  await page.waitForSelector('.failure');
  assert.match(await page.$eval('[data-card="fast"]', node => node.textContent), /request is ready/);
  await page.click('.failure button');
  await page.waitForFunction(() => document.querySelector('.failure') === null);
  assert.equal(await page.$eval('input', node => node.value), 'Keep my draft');
  assert.equal((await page.$$('.card-row')).length, 3);
  console.log('PASS progressive row inheritance and local retry preserve the draft');

  await visit('/atomic/first');
  await page.waitForSelector('.atomic-pending');
  assert.equal(await page.$('[data-board]'), null);
  assert.equal(await page.$('input'), null);
  await page.waitForSelector('[data-board="atomic"]');
  assert.equal((await page.$$('.card-row')).length, 3);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT');
  console.log('PASS atomic publication waits for all rows and then releases the focus ref');

  await visit('/atomic/canceled');
  await page.waitForSelector('.atomic-pending');
  await page.click('#toggle-board');
  await page.waitForSelector('[data-abandoned]');
  await wait(3000);
  assert.equal(await page.$('[data-board]'), null);
  console.log('PASS abandoned atomic work cannot publish stale rows');

  await visit('/progressive/entry');
  await page.waitForSelector('[data-board="progressive"]');
  await page.click('header a[href="/detail/fast"]');
  assert.equal(new URL(page.url()).pathname, '/progressive/entry');
  assert.ok(await page.$('[data-board="progressive"]'));
  await page.waitForSelector('[data-detail="fast"]');
  await page.type('input', 'Detail draft');
  await page.click('a[href="/detail/fast?tab=notes"]');
  await page.waitForFunction(() => location.search === '?tab=notes');
  assert.equal(await page.$eval('input', node => node.value), 'Detail draft');
  await page.click('a[href="/detail/slow"]');
  await page.waitForSelector('[data-detail="slow"]');
  assert.equal(await page.$eval('input', node => node.value), '');
  console.log('PASS deferred entry, query retention, and path-parameter remount');

  await page.click('header a[href="/detail/fast"]');
  await page.click('header a[href="/progressive/second"]');
  await page.waitForSelector('[data-board="progressive"]');
  await wait(2200);
  assert.equal(new URL(page.url()).pathname, '/progressive/second');
  assert.equal(await page.$('[data-detail]'), null);
  assert.deepEqual(errors, []);
  console.log('PASS superseded entry cannot navigate back or duplicate the destination');
} finally {
  await browser?.close();
  await server.close();
}
