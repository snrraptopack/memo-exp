import { mount } from '@memoized-dom/runtime';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { SsrAppApp } from './SsrApp';
import './styles.css';

// Client-side DataRuntime claims the DOM-embedded JSON payload channel
const clientData = createDataRuntime();
setActiveDataRuntime(clientData);

// Unified hydration entry point: adopts server HTML in place
mount('root', SsrAppApp, { hydration: true });
