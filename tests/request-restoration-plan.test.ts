import { expect, it } from 'bun:test';
import {compileModulesDetailed} from '@memoized-dom/compiler';

const modules = {
  './user.ts': `export const user=$fetch('/user');`,
  './App.tsx': `import {user} from './user';export function App(){let name='Ada';const detail=$fetch('/detail',{query:{name}});
    return <main><button onClick={()=>name='Lin'}>Change</button><p>{user?.name}{detail?.name}</p></main>;}`,
};

it('keeps standalone compiled sources ready for SSR restoration by default', () => {
  const {output} = compileModulesDetailed(modules);
  for (const id of Object.keys(modules)) expect(output[id]).toContain('createBodylessSource');
  expect(output['./user.ts']).toContain('describeModuleSource');
  expect(output['./App.tsx']).toContain('rebindResolvedValue');
});

it('uses explicit client delivery facts without changing source lifetime or replay', () => {
  const {output} = compileModulesDetailed(modules, {dataDelivery:'client'});
  for (const id of Object.keys(modules)) {
    expect(output[id]).toContain('createClientSource');
    expect(output[id]).not.toContain('createBodylessSource');
  }
  expect(output['./user.ts']).toContain('describeModuleSource');
  expect(output['./App.tsx']).toContain('rebindResolvedValue');
});

it('does not impose framework restoration hooks on custom providers or source-free components', () => {
  const {output} = compileModulesDetailed({'./App.tsx':`export function App(){return <p>Hello</p>;}`});
  expect(output['./App.tsx']).not.toContain('installActiveDataRestoration');
  const custom = compileModulesDetailed(modules, {dataRuntimePath:'./custom'});
  expect(Object.values(custom.output).join('\n')).not.toContain('installActiveDataRestoration');
});

it('keeps server compilation transferable even when a client-only fact is supplied', () => {
  const {output} = compileModulesDetailed(modules, {dataDelivery:'client',routedEnvironment:'server'});
  for (const id of Object.keys(modules)) {
    expect(output[id]).toContain('createBodylessSource');
    expect(output[id]).not.toContain('createClientSource');
  }
});
