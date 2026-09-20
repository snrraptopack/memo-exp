/**
 * Client entry — browser bootstrap.
 *
 * `mount` detects the server root. It reads
 *      the payload from the inline `<script type="application/mmd+json">`
 *      tag, restores the automatically available data runtime, then adopts
 *      the server-rendered DOM
 *      using the hydration cursor (the <!--mmd:r:App--> / <!--/mmd-->
 *      boundary comments the server embedded). Zero duplicate requests,
 *      zero DOM recreation.
 *
 * Navigation after hydration is purely client-side: the router's pushState
 * subscription intercepts clicks forwarded from the Nav onClick handlers
 * and re-renders only the outlet subtree.
 */
import { mount } from '@memoized-dom/runtime';
import { App } from './App';
import './styles.css';
import './session';

mount('root', App);
