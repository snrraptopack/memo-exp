import { setDefaultTimeout } from 'bun:test';

// Compiler, bundle and browser integration tests also run on slower machines.
setDefaultTimeout(30_000);
