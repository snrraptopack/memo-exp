/**
 * Client entry — hydration bootstrap.
 *
 * The data runtime is installed first so `hydrate` can restore the server
 * payload before the compiled tree adopts the marked DOM. Every server
 * function call resolves from the `application/mmd+json` payload on
 * hydration without refetching.
 */
import { hydrate } from '@memoized-dom/runtime/hydrate';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { App } from './App';

setActiveDataRuntime(createDataRuntime());

hydrate('root', App, {
  recover: true,
  onRecover: (err) => {
    console.error('[HYDRATION-MISMATCH]', err.message);
  },
});
