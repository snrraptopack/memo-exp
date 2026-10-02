import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { clearDataRuntime } from '@memoized-dom/data';
import { _internals, resetAccessTable, resetScheduler, setScheduler, unregister } from '@memoized-dom/runtime/testing';

const directory = join(import.meta.dirname, 'fixtures/out/form-image-search');
const row = `export default function ImageLoader({photo}) {
  let imgSrc = ''; let imgRef = null;
  $effect(() => {
    const loadImage = () => {
      const img = new Image();
      img.onload = () => { imgSrc = photo.src.large; };
      img.src = photo.src.large;
    };
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          imgSrc = photo.src.small; loadImage(); observer.unobserve(entry.target);
        }
      });
    });
    if (imgRef) observer.observe(imgRef);
    return () => observer.disconnect();
  });
  return <img ref={imgRef} class="loading-image" style={{aspectRatio:photo.width/photo.height}} src={imgSrc} alt={photo.alt}/>;
}`;
const app = `import ImageLoader from './image';
  const App = () => {
    const forms = $forms(field => {
      const searchTerm = field.get('searchTerm');
      const images = $fetch('/api/photos', {query:{per_page:30,query:searchTerm}});
      return images;
    });
    return <main><form onSubmit={forms.submit}><input name="searchTerm"/><button type="submit">Search</button></form>
      {forms.pending && <p class="pending">Loading</p>}
      <section>{forms.result?.map(photo => <ImageLoader key={photo.id} photo={photo}/>)}</section>
      {forms.errors && forms.errors.map(error => <div class="error" key={error.message}>{error.message}</div>)}
    </main>;
  }; export default App;`;

afterEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  clearDataRuntime(); resetAccessTable(); resetScheduler();
  document.body.replaceChildren(); vi.unstubAllGlobals();
});

it.each([false, true].flatMap(hot => [false,true].flatMap(deferred => ['array','envelope','invalid'].map(shape => ({hot,deferred,shape})))))(
  'submits image search and recovers independently (hot=$hot, deferred=$deferred, shape=$shape)', async ({hot,deferred,shape}) => {
  const source = shape === 'envelope' ? app.replace('forms.result?.map', 'forms.result?.photos.map') : app;
  const {output} = compileModulesDetailed({'./app.tsx': source, './image.tsx': row}, {hot});
  const name = `${hot ? 'hot' : 'production'}-${deferred}-${shape}`, target = join(directory, name);
  mkdirSync(target, {recursive:true});
  for (const [file, code] of Object.entries(output)) writeFileSync(join(target, file.slice(2).replace(/\.tsx$/, '.ts')), code);
  const errors: unknown[] = [];
  const recordError = (error: unknown) => {
    if (error instanceof AggregateError) error.errors.forEach(recordError);
    else errors.push(error);
  };
  vi.stubGlobal('reportError', recordError);
  let resolveFetch!: (value: Response) => void;
  const requests = vi.fn((_url: string | URL | Request) => new Promise<Response>(resolve => {resolveFetch = resolve;}));
  vi.stubGlobal('fetch', requests);
  const images: Array<{onload: (() => void) | null; src: string}> = [];
  vi.stubGlobal('Image', class {
    onload = null; src = '';
    constructor() { images.push(this); }
  });
  const observers: Array<{callback: (entries: Array<{isIntersecting:boolean;target:Element}>) => void;
    observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    constructor(public callback: typeof observers[number]['callback']) { observers.push(this); }
  });
  const work: Array<() => void> = [];
  // Both hosts report render failures rather than throwing them back into a
  // form action. The browser's microtask host has that same separation.
  setScheduler(run => {
    if (deferred) work.push(run);
    else { try {run();} catch (error) {recordError(error);} }
  });
  const flush = () => { while (work.length) {
    try { work.shift()!(); } catch (error) { recordError(error); }
  } };
  const specifier = `./fixtures/out/form-image-search/${name}/app.ts`;
  const {default: App} = await import(specifier); document.body.append(App('App', null)); flush();
  const form = document.querySelector('form')!; form.querySelector('input')!.value = 'forest';
  const event = new SubmitEvent('submit', {bubbles:true,cancelable:true,submitter:form.querySelector('button')});
  form.dispatchEvent(event); flush();
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('.pending')).not.toBeNull();
  await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
  expect(String(requests.mock.calls[0]![0])).toContain('query=forest');
  const photos = [{id:1,width:600,height:400,alt:'forest',src:{small:'/small.jpg',large:'/large.jpg'}}];
  const respond = (payload: unknown) => resolveFetch(new Response(JSON.stringify(payload), {headers:{'content-type':'application/json'}}));
  respond(shape === 'array' ? photos : {page:1,photos});
  if (shape === 'invalid') {
    await vi.waitFor(() => { flush(); expect(errors.some(error => String(error).includes('requires an array'))).toBe(true); });
    expect(document.querySelector('.pending')).toBeNull();
    expect(document.querySelector('form')).toBe(form); expect(observers).toHaveLength(0);
    errors.length = 0; form.querySelector('input')!.value = 'mountain';
    form.dispatchEvent(new SubmitEvent('submit', {bubbles:true,cancelable:true,submitter:form.querySelector('button')}));
    flush(); expect(document.querySelector('.pending')).not.toBeNull();
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2)); respond(photos);
  }
  await vi.waitFor(() => { flush(); expect(document.querySelector('.loading-image')).not.toBeNull(); });
  if (shape === 'invalid') {
    // A new attempt retains the last result until success, so earlier queued
    // renders may still diagnose it. A valid result must finish that recovery.
    expect(errors.every(error=>error instanceof TypeError && error.message.includes('requires an array'))).toBe(true);
    errors.length = 0;
  }
  flush(); expect(document.querySelector('.pending')).toBeNull(); expect(document.querySelector('.error')).toBeNull();
  await vi.waitFor(() => { flush(); expect(observers.some(observer => observer.observe.mock.calls.length > 0)).toBe(true); });
  const img = document.querySelector<HTMLImageElement>('.loading-image')!;
  const observer = observers.find(value => value.observe.mock.calls.length > 0)!;
  observer.callback([{isIntersecting:true,target:img}]); flush();
  expect(img.getAttribute('src')).toBe('/small.jpg'); expect(images).toHaveLength(1);
  images[0]!.onload!(); flush(); expect(img.getAttribute('src')).toBe('/large.jpg');
  expect(errors).toEqual([]);
  unregister('App'); expect(observer.disconnect).toHaveBeenCalledTimes(1);
});
