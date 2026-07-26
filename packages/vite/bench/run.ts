/**
 * Measures linked Vite startup and cached adapter transforms on the fixture app.
 */
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import {
  createServer,
  normalizePath,
  type EnvironmentModuleNode,
} from 'vite';
import memoizedDom from '../src';

const packageRoot = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(packageRoot, 'tests/fixtures/vite-app');
const appFile = normalizePath(resolve(fixtureRoot, 'src/App.tsx'));
const appUrl = '/src/App.tsx';
const cachedRuns = 500;
const pipelineRuns = 50;

const startupStart = performance.now();
const server = await createServer({
  root: fixtureRoot,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  resolve: { alias: { '@': resolve(fixtureRoot, 'src') } },
  plugins: [
    memoizedDom({
      entries: 'src/App.tsx',
      rootId: 'App',
    }),
  ],
});
const startupMs = performance.now() - startupStart;
const environment = server.environments.client;

const firstStart = performance.now();
await environment.transformRequest(appUrl);
const firstTransformMs = performance.now() - firstStart;

const cachedStart = performance.now();
for (let index = 0; index < cachedRuns; index++) {
  await environment.transformRequest(appUrl);
}
const cachedTransformUs =
  ((performance.now() - cachedStart) * 1_000) / cachedRuns;

const pipelineStart = performance.now();
for (let index = 0; index < pipelineRuns; index++) {
  const modules = environment.moduleGraph.getModulesByFile(appFile);
  if (modules !== undefined) {
    for (const module of modules) {
      environment.moduleGraph.invalidateModule(
        module as EnvironmentModuleNode,
      );
    }
  }
  await environment.transformRequest(appUrl);
}
const cachedPipelineMs =
  (performance.now() - pipelineStart) / pipelineRuns;

await server.close();

console.log(`Vite startup + linked graph  ${startupMs.toFixed(2)} ms`);
console.log(`First App transform          ${firstTransformMs.toFixed(2)} ms`);
console.log(`Vite request cache           ${cachedTransformUs.toFixed(2)} us/op`);
console.log(`Cached adapter pipeline      ${cachedPipelineMs.toFixed(2)} ms/op`);
