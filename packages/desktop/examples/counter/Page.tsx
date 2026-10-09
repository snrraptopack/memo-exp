import type {} from '@memoized-dom/compiler/jsx';
import { App } from './App';
import './app.css';

export function Page() {
  return <div id="desktop-page" class="desktop-page"><App /></div>;
}
