import { afterEach, expect, it, vi } from 'bun:test';
import { initializePayload } from '../packages/runtime/src/payload';
import { mountInitial, registerRootFactory } from '../packages/runtime/src/mount-core';
import { createApplicationRuntime, runWithApplicationRuntime, getExtensionStore, registerEntity, has } from '../packages/runtime/src/kernel';
import { cleanup } from '../packages/runtime/src/cleanup';

afterEach(() => document.body.replaceChildren());

it('restores before initial bindings and completes after the shared mount owns the retained root',()=>{
  const runtime=createApplicationRuntime('payload-success',{document,schedule:null});
  try { runWithApplicationRuntime(runtime,()=>{
    document.body.innerHTML='<div id="root"><main>Kept</main></div><script type="application/mmd+json" data-mmd-root="App">{"version":1,"state":"server"}</script>';
    const main=document.querySelector('main')!;
    const order:string[]=[];
    const bridge=getExtensionStore<Record<string,unknown>>('mmd:data-runtime-active',()=>({}));
    bridge.restoreState=(value:unknown)=>order.push(`restore:${value}`);
    bridge.completeHydration=()=>order.push('complete');bridge.cancelHydration=vi.fn();
    const App=()=>undefined;
    registerRootFactory(App,{id:'App',create(){
      order.push('create');registerEntity({id:'App',parent:null,render(){}});return main;
    }});
    const app=mountInitial('root',App,initializePayload);
    try {
      expect(order).toEqual(['restore:server','create','complete']);
      expect(app.nodes).toEqual([main]);expect(document.querySelector('main')).toBe(main);
      expect(bridge.cancelHydration).not.toHaveBeenCalled();expect(document.querySelector('script')).toBeNull();
    } finally {app.unmount();}
    expect(has('App')).toBe(false);
  }); } finally {runtime.dispose();}
});

it.each([false,true])('unregisters failed initializers and finishes the data handoff (recoverable=%s)',recoverable=>{
  const runtime=createApplicationRuntime('payload-failure',{document,schedule:null});
  try { runWithApplicationRuntime(runtime,()=>{
    document.body.innerHTML='<div id="root"></div><script type="application/mmd+json" data-mmd-root="App">{"version":1}</script>';
    const bridge=getExtensionStore<Record<string,unknown>>('mmd:data-runtime-active',()=>({}));
    const complete=vi.fn(),cancel=vi.fn(),dispose=vi.fn();
    bridge.completeHydration=complete;bridge.cancelHydration=cancel;
    const failure=new Error('adopter failed');
    expect(()=>initializePayload(document.getElementById('root')!,{id:'App',create(){throw failure;}},()=>{
      registerEntity({id:'App',parent:null,render(){}});cleanup('App',dispose);throw failure;
    },()=>recoverable)).toThrow(failure);
    expect(has('App')).toBe(false);expect(dispose).toHaveBeenCalledTimes(1);
    expect(recoverable?complete:cancel).toHaveBeenCalledTimes(1);
    expect(recoverable?cancel:complete).not.toHaveBeenCalled();expect(document.querySelector('script')).toBeNull();
  }); } finally {runtime.dispose();}
});
