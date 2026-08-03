/**
 * @file entry.ts
 * Browser entry point for the DOM Ref Laboratory example.
 */
import { mount } from '@memoized-dom/runtime';
import { RefsApp } from './refs/RefsApp';
import './refs/styles.css';

mount('root', RefsApp);
