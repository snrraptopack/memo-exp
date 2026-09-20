/**
 * Client entry — hydration bootstrap.
 *
 * `mount` restores the server payload into the default data runtime before
 * the compiled tree adopts the marked DOM. Server-function calls can reuse
 * SSR data without manual runtime setup or refetching.
 */
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
