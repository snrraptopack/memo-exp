import { execFileSync } from 'node:child_process';
import { expect, it } from 'bun:test';

it('installs async request context after client initialization and binds queued work within another request', () => {
  const output=execFileSync(process.execPath,['--input-type=module','-e',`
    import * as client from '@memoized-dom/runtime/client';
    const ambient=client.getActiveApplicationRuntime();
    const probe=client.createApplicationRuntime('client-probe');
    client.runWithApplicationRuntime(probe,()=>client.registerEntity({id:'Probe',parent:null,render(){}}));
    probe.dispose();
    const host=await import('@memoized-dom/runtime/server');
    const a=host.createApplicationRuntime('a'),b=host.createApplicationRuntime('b');
    const identities=await Promise.all([a,b].map(runtime=>host.runWithApplicationRuntime(runtime,async()=>{
      await new Promise(resolve=>setTimeout(resolve,1));
      return host.getActiveApplicationRuntime().id;
    })));
    const queued=[],renders=[];
    host.runWithApplicationRuntime(a,()=>{
      host.setScheduler(run=>queued.push(run));
      host.registerEntity({id:'App',parent:null,render(){renders.push(host.getActiveApplicationRuntime().id);}});
      host.markDirty('App');
    });
    const restored=await host.runWithApplicationRuntime(b,async()=>{
      await Promise.resolve();queued.shift()();
      return host.getActiveApplicationRuntime().id;
    });
    a.dispose();b.dispose();
    console.log(JSON.stringify({identities,renders,restored,ambient:host.getActiveApplicationRuntime()===ambient}));
  `],{cwd:process.cwd(),encoding:'utf8'});
  expect(JSON.parse(output.trim())).toEqual({identities:['a','b'],renders:['a'],restored:'b',ambient:true});
});
