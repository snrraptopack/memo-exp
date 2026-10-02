import puppeteer, {type Browser} from 'puppeteer-core';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {updateStyleReport, type UpdateStyleResult, type UpdateStyleRow} from './update-style-report';

export async function runUpdateStyles(browser: Browser, validateOnly = false, samples = 7): Promise<UpdateStyleResult | undefined> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('console',message => console.log(message.text()));
  page.on('pageerror',error => errors.push(String(error)));
  try {
    await page.goto(pathToFileURL(resolve(import.meta.dirname,'update-style-browser.html')).href,{waitUntil:'load'});
    if (validateOnly) {
      await page.evaluate(() => (window as unknown as {__validateUpdateStyles():void}).__validateUpdateStyles());
      if (errors.length) throw new Error(errors.join('\n'));
      console.log('All 16 mutable/immutable variants passed identity and mixed-sequence checks.');
      return;
    }
    const rows = await page.evaluate(samples => (window as unknown as {
      __runUpdateStyles(samples:number):UpdateStyleRow[];
    }).__runUpdateStyles(samples),samples);
    if (errors.length) throw new Error(errors.join('\n'));
    return {measuredAt:new Date().toISOString(),samples,rows};
  } finally { await page.close(); }
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--validate-only' && !/^--samples=\d+$/.test(arg))) throw new Error('Use --validate-only or --samples=N');
  const samples = Number(args.find(arg => arg.startsWith('--samples='))?.split('=')[1] ?? 7);
  const browser = await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
    headless:true,protocolTimeout:600000,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
  try {
    const result = await runUpdateStyles(browser,args.includes('--validate-only'),samples);
    if (result) {
      writeFileSync(resolve(import.meta.dirname,'dist/update-style/results.json'),JSON.stringify(result,null,2)+'\n');
      const report = '# DOM update styles\n\n' + updateStyleReport(result);
      writeFileSync(resolve(import.meta.dirname,'dist/update-style/results.md'),report);
      console.log(report);
    }
  } finally { await browser.close(); }
}
