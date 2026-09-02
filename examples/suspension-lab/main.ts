import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { mount } from '@memoized-dom/runtime';
import { createLabFetch } from './api';
import { SuspensionLabApp } from './SuspensionLabApp';
import './styles.css';

const data = createDataRuntime({ fetch: createLabFetch() });
setActiveDataRuntime(data);

mount('root', SuspensionLabApp);
