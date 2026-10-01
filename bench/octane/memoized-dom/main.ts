import { mount, setScheduler } from '@memoized-dom/runtime';
import { OctaneBench } from './App';

// Complete commits within the harness's synchronous click window.
setScheduler(run => run());
mount('main', OctaneBench);
