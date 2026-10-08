import { expect, it } from 'bun:test';
import {parseEstreeOrThrow} from '../packages/compiler/src/ast';
import type * as t from '../packages/compiler/src/ast/compiler-types';
import {planRouterJsx} from '../packages/compiler/src/analysis/routes';

function source(code:string){
  const program=parseEstreeOrThrow(code,{filename:'./routes.tsx'}).program as unknown as t.Program;
  const input={node:program,buildCodeFrameError:(message:string)=>new Error(message)};
  return {program,input};
}

it('captures nested routes and destinations without changing authored JSX',()=>{
  const {program,input}=source(`function App(){return <main route="/teams"><section route="/:id">
    <a route-to={{path:'/teams/:id',params:{id:teamId},query:{tab:'people'}}}>Team</a>
    </section><a route-to="/teams">Teams</a></main>;}`);
  const before=JSON.stringify(program),plan=planRouterJsx(input,'./routes.tsx');
  expect(JSON.stringify(program)).toBe(before);
  expect(plan.routes.map(site=>site.definition.fullPattern)).toEqual(['/teams','/teams/:id']);
  expect(plan.routes[1]!.definition.parentId).toBe(plan.routes[0]!.definition.id);
  expect(plan.links.map(site=>site.target.path)).toEqual(['/teams/:id','/teams']);
  expect(plan.links[0]!.target.options).not.toBeNull();
  expect(plan.links[1]!.target.options).toBeNull();
  expect(JSON.stringify(plan)).not.toMatch(/createRouteManifest|registerRouteComponent|buildRoutePath/);
});

it('validates authored dynamic routes and unresolved or incomplete destinations in shared planning',()=>{
  for(const [code,error] of [
    ['function App(){return <main route={path}/>;}','route must be a static string'],
    ['function App(){return <a route-to="/missing"/>;}','undeclared route'],
    ['function App(){return <main route="/teams/:id"><a route-to="/teams/:id"/></main>;}','requires params'],
  ]){
    const {input}=source(code!);
    expect(()=>planRouterJsx(input,'./routes.tsx')).toThrow(error);
  }
});

it('resolves linked route destinations without requiring a local route or backend context',()=>{
  const {program,input}=source('function App(){return <a route-to="/elsewhere"/>;}');
  const before=JSON.stringify(program);
  const plan=planRouterJsx(input,'./routes.tsx',[
    {id:'remote',moduleId:'./Remote.tsx',pattern:'/elsewhere',fullPattern:'/elsewhere'},
  ]);
  expect(plan.routes).toEqual([]);
  expect(plan.links[0]!.target.path).toBe('/elsewhere');
  expect(JSON.stringify(program)).toBe(before);
});
