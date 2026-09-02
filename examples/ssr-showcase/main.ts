/**
 * Client entry — browser bootstrap.
 *
 * Two things must happen before `mount` is called:
 *
 *   1. A DataRuntime is created and made active. The runtime registers
 *      `restoreState` on the extension store so that `hydrate` can install the payload
 *      that the server embedded in the document before the component tree
 *      is re-executed. Without this step every module source would issue
 *      a fresh network request, defeating the purpose of payload transport.
 *
 *   2. `hydrate` is imported from the explicit hydration entry. It reads
 *      the payload from the inline `<script type="application/mmd+json">`
 *      tag, restores the data state, then adopts the server-rendered DOM
 *      using the hydration cursor (the <!--mmd:r:App--> / <!--/mmd-->
 *      boundary comments the server embedded). Zero duplicate requests,
 *      zero DOM recreation.
 *
 * Navigation after hydration is purely client-side: the router's pushState
 * subscription intercepts clicks forwarded from the Nav onClick handlers
 * and re-renders only the outlet subtree.
 */
import { hydrate } from '@memoized-dom/runtime/hydrate';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { App } from './App';
import './styles.css';
import './session';

setActiveDataRuntime(createDataRuntime());

hydrate('root', App, {
  recover: true,
  onRecover: (err) => {
    console.error('[HYDRATION-MISMATCH]', err.message);
  },
});
