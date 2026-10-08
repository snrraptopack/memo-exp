import { GlobalRegistrator } from '@happy-dom/global-registrator';
import './setup';

// Keep Bun's network and timer implementations, including native fake timers.
const native = Object.fromEntries([
  'fetch', 'Request', 'Response', 'Headers', 'AbortController', 'AbortSignal',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)!]));

GlobalRegistrator.register({ url: 'http://localhost:3000' });
Object.defineProperties(globalThis, native);
