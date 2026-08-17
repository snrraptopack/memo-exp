/**
 * @file entry.ts
 * Browser entry point for the Apex Cloud Console Router application.
 */
import { mount } from '@memoized-dom/runtime';
import { RouterApp } from './router-app/RouterApp';
import './router-app/styles.css';

mount('root', RouterApp);
