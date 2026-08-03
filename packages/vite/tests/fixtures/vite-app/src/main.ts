/** Ordinary TypeScript browser bootstrap and compiler graph entry. */
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

const host = document.createElement('div');
host.id = 'root';
document.body.append(host);
mount('root', App);
