/**
 * @file entry.ts
 * Browser entry point for the DOM Ref Laboratory example.
 */
import { mount } from '@memoized-dom/runtime';
import { DataReactivityApp } from './data-reactivity/DataReactivityApp';
import './data-reactivity/styles.css';

mount('root', DataReactivityApp);
