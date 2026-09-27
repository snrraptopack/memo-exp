import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { mount } from '@memoized-dom/runtime';
import { App } from './App';
import { createDemoFetch } from './data/transport';
import './styles.css';

// Demo-only transport injection: no global fetch replacement or remote service.
const data = createDataRuntime({ fetch: createDemoFetch() });
setActiveDataRuntime(data);
mount('root', App);
