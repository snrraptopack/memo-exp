/** Stable authored graphs; examples are measured separately and may change. */
export const sizeFixtures: Record<string, Record<string, string>> = {
  ...Object.fromEntries([1,24].flatMap(count=>['composition','request'].map(kind=>[`${kind}-recreated-slot-${count}`,{
    './App.tsx': `import {Shell} from './Shell';export function App(){let n=0;let open=true;
      ${kind==='request'?"const user=$fetch('/api/user');const request=$track(user);":''}
      return <main><h1>Delivered surroundings</h1><button class="next" onClick={()=>n++}>Next</button>
      <button class="toggle" onClick={()=>open=!open}>Toggle</button>
      ${kind==='request'?'<button class="reload" onClick={()=>request.refresh()}>Reload</button>':''}
      {${kind==='request'?'user?.rows?.map(item=>':'open&&'}<Shell ${kind==='request'?'key={item.id}':''}>
        ${Array.from({length:count},(_,index)=>`<article><h2>Card ${index}</h2><p>Ready.</p></article>`).join('')}
        <button class="inside" title={'value '+n} onClick={()=>n++}>{n}</button>
        ${kind==='request'?'<b>{item.label}</b>':''}</Shell>${kind==='request'?')':''}}
      <footer>{n}</footer></main>;}`,
    './Shell.tsx': `export function Shell({children}){return <section>{children}</section>;}`,
  }]))),
  ...Object.fromEntries(['inline','component'].map(kind=>[`primitive-${kind}-list`,{
    './App.tsx':`${kind==='component' ? "import {Row} from './Row';" : ''}export function App(){
      let items=[{id:1,value:1},{id:2,value:2},{id:3,value:3}];return <main>
      <button class="next" onClick={()=>items[1].value++}>Next</button>
      <button class="reverse" onClick={()=>items=items.toReversed()}>Reverse</button>
      <ul>{items.map(item=>${kind==='component' ? '<Row key={item.id} item={item}/>'
        : '<li key={item.id}>{item.value*2}</li>'})}</ul></main>;}`,
    ...(kind==='component' ? {'./Row.tsx':'export function Row({item}){return <li>{item.value*2}</li>;}' } : {}),
  }])),
  'dynamic-tags': {
    './App.tsx': `import {selectView} from './views';export function App(){let compact=true;let value=0;
      const Host=compact?'section':'article';const View=selectView(compact);return <main>
      <button class="swap" onClick={()=>compact=!compact}>Swap</button>
      <button class="next" onClick={()=>value++}>Next</button>
      <Host data-role="host"><View value={value}/></Host><p>{value}</p></main>;}`,
    './views.tsx': `export function Summary({value}){return <strong>summary:{value}</strong>;}
      export function Details({value}){return <output>details:{value}</output>;}
      export function selectView(compact){return compact?Summary:Details;}`,
  },
  'request-variable-extents': {
    './App.tsx': `export function App(){const user=$fetch('/api/user');const request=$track(user);let n=0;return <main>
      <button class="next" onClick={()=>n++}>Next</button><button class="reload" onClick={()=>request.refresh()}>Reload</button>
      {user?.active&&<section><h2>{user.name}:{n}</h2></section>}<h3>Between {n}</h3>
      {user?.rows?.map(item=><li key={item.id}>{item.active&&<b>{item.label}</b>}<span>{n}</span></li>)}<p>Middle {n}</p>
      {user?.tags?.map(tag=><em key={tag.id}>{tag.label}:{n}</em>)}<footer>Kept {n}</footer></main>;}`,
  },
  'closed-nested-structures': {
    './App.tsx': `export function App(){let n=100;let groups=[{id:1,active:true,rows:[{id:11,label:'one'},{id:12,label:'two'}]},
      {id:2,active:false,rows:[]},{id:3,active:true,rows:[]}];return <main>
      <button class="reverse" onClick={()=>groups=groups.toReversed()}>Reverse</button>
      <button class="toggle" onClick={()=>groups=groups.map(group=>({...group,active:!group.active}))}>Toggle</button>
      <button class="append" onClick={()=>groups=groups.map(group=>({...group,rows:[...group.rows,{id:n++,label:'new'}]}))}>Append</button>
      {groups.map((group,index)=><article key={group.id}><h2>{index}:{group.id}</h2>
        {group.active&&<section><b>Before</b>{group.rows.map(row=><em key={row.id}>{row.label}</em>)}<small>After</small></section>}
        <p>Group end</p></article>)}<footer>{n}</footer></main>;}`,
  },
  'request-component-structures': {
    './App.tsx': `import {Row} from './Row';export function App(){const user=$fetch('/api/user');const request=$track(user);let n=0;return <main>
      <button class="next" onClick={()=>n++}>Next</button><button class="reload" onClick={()=>request.refresh()}>Reload</button>
      <ul>{user?.rows?.map((item,index)=><Row key={item.id} item={item} index={index} suffix={n}/>)}</ul><footer>Kept {n}</footer></main>;}`,
    './Row.tsx': `export function Row({item,index,suffix}){let n=0;return <li data-id={item.id}><h2>{index}:{item.label}:{suffix}</h2>
      <button class="row-next" onClick={()=>n++}>{n}</button>
      {item.active?<section><b>Active</b><div>{item.tags.map(tag=><em key={tag.id}>{tag.label}</em>)}</div><small>After tags</small></section>:<aside>Hidden</aside>}
      <p>Row end</p></li>;}`,
  },
  'request-row-children': {
    './App.tsx': `import {Row} from './Row';export function App(){const user=$fetch('/api/user');const request=$track(user);let n=0;return <main>
      <button class="next" onClick={()=>n++}>Next</button><button class="reload" onClick={()=>request.refresh()}>Reload</button>
      <ul>{user?.rows?.map((item,index)=><Row key={item.id}><b>{index}:{item.label}:{n}</b></Row>)}</ul><footer>Kept {n}</footer></main>;}`,
    './Row.tsx': `import {Frame} from './Frame';export function Row({children}){let n=0;return <li>
      <button class="row-next" onClick={()=>n++}>{n}</button>{children}<Frame>{children}</Frame></li>;}`,
    './Frame.tsx': `export function Frame({children}){return <aside><i>Prefix</i>{children}</aside>;}`,
  },
  'request-conditional-list': {
    './App.tsx': `export function App(){const user=$fetch('/api/user');const request=$track(user);let n=0;return <main>
      <button class="next" onClick={()=>n++}>Next</button><button class="reload" onClick={()=>request.refresh()}>Reload</button>
      {user?.active?<ul>{user.rows.map(item=><li key={item.id}>{item.active?<b>{item.label}</b>:<i>Hidden</i>}<span>{n}</span></li>)}</ul>:<p>Closed</p>}
      <footer>Kept {n}</footer></main>;}`,
  },
  'request-component-list': {
    './App.tsx':`import {Row} from './Row';export function App(){const user=$fetch('/api/user');const request=$track(user);let n=0;
      return <main><button class="next" onClick={()=>n++}>Next</button><button class="reload" onClick={()=>request.refresh()}>Reload</button>
        <ul>{user?.rows?.map((item,index)=><Row key={item.id} item={item} index={index} suffix={n}/>)}</ul><footer>Kept {n}</footer></main>;}`,
    './Row.tsx':`import {Label} from './Label';export function Row({item,index,suffix}){let count=0;return <li data-id={item.id}><span>{index}:<Label text={item.label}/>:{suffix}</span><button class="row-next" onClick={()=>count++}>{count}</button></li>;}`,
    './Label.tsx':`export function Label({text}){return <b>{text}</b>;}`,
  },
  'composition-recreated-structural-children': {
    './App.tsx':`import {Shell} from './Shell';export function App(){let open=true;let shown=true;let n=1;let items=[{id:1,label:'one'},{id:2,label:'two'}];
      return <main><button class="toggle" onClick={()=>open=!open}>Toggle</button><button class="next" onClick={()=>n++}>Next</button>
        <button class="shown" onClick={()=>shown=!shown}>Shown</button><button class="reverse" onClick={()=>items=items.toReversed()}>Reverse</button>
        {open&&<Shell>{shown&&<b>{n}</b>}{items.map((item,index)=><li key={item.id}>{index}:{item.label}:{n}</li>)}</Shell>}<p>{n}</p></main>;}`,
    './Shell.tsx':`export function Shell({children}){return <section><h2>Before</h2>{children}<footer>After</footer></section>;}`,
  },
  'route-lazy': {
    './App.tsx':`import {Detail} from './Detail';export function App(){return <main route="/"><nav><a class="home" route-to="/">Home</a><a class="about" route-to="/about">Detail</a></nav><section route="/"><h2>Home</h2></section><Detail route="/about"/></main>;}`,
    './Detail.tsx':`export function Detail(){let n=0;return <article><h2>Detail</h2><button onClick={()=>n++}>{n}</button></article>;}`,
  },
  'composition-static-children': {
    './App.tsx': `import {Shell} from './Shell';export function App(){const name='Ada';let count=0;return <main>
      <button onClick={()=>count++}>Add</button><p>{count}</p><Shell><h2>Static card</h2><p>{name}</p></Shell></main>;}`,
    './Shell.tsx': `export function Shell({children}){return <section>{children}</section>;}`,
  },
  'composition-static-children-60': {
    './App.tsx': `import {Shell} from './Shell';export function App(){let count=0;return <main>
      <button onClick={()=>count++}>Add</button><p>{count}</p>
      ${Array.from({length:60},(_,index)=>`<Shell><h2>Static card ${index}</h2><p>Ready.</p></Shell>`).join('')}</main>;}`,
    './Shell.tsx': `import {Frame} from './Frame';export function Shell({children}){return <section><Frame>{children}</Frame></section>;}`,
    './Frame.tsx': `export function Frame({children}){return <aside>{children}</aside>;}`,
  },
  'composition-live-children': {
    './App.tsx': `import {Shell} from './Shell';export function App(){let count=0;return <main>
      <button onClick={()=>count++}>Add</button><Shell><p>{count}</p></Shell></main>;}`,
    './Shell.tsx': `export function Shell({children}){return <section>{children}</section>;}`,
  },
  'composition-live-forwarded-children': {
    './App.tsx': `import {Counter} from './Counter';export function App(){return <main><Counter start={1}/><Counter start={10}/></main>;}`,
    './Counter.tsx': `import {Shell} from './Shell';export function Counter({start}){let n=start;function next(){n++;}
      return <article><Shell><button onClick={next}>{n}</button><p title={'count:'+n}>{n*2}</p></Shell></article>;}`,
    './Shell.tsx': `import {Frame} from './Frame';export function Shell({children}){return <section><h2>Counter</h2><Frame>{children}</Frame></section>;}`,
    './Frame.tsx': `export function Frame({children}){return <aside>{children}</aside>;}`,
  },
  'composition-conditional-children': {
    './App.tsx': `import {Shell} from './Shell';export function App(){let open=true;let n=0;
      return <main><button onClick={()=>open=!open}>Toggle</button><button onClick={()=>n++}>Next</button>
        <Shell>{open?<b title={'count:'+n}>{n}</b>:<i>Closed</i>}</Shell><p>{n}</p></main>;}`,
    './Shell.tsx': `export function Shell({children}){return <section><h2>Before</h2>{children}<footer>After</footer></section>;}`,
  },
  'composition-list-children': {
    './App.tsx': `import {Shell} from './Shell';export function App(){let items=[{id:1,label:'one'},{id:2,label:'two'}];let next=3;
      return <main><button onClick={()=>items=[...items,{id:next++,label:'new'}]}>Append</button>
        <button onClick={()=>items=items.toReversed()}>Reverse</button>
        <Shell>{items.map((item,index)=><li key={item.id}>{index}:{item.label}</li>)}</Shell></main>;}`,
    './Shell.tsx': `export function Shell({children}){return <section><h2>Rows</h2><ul>{children}</ul><footer>After</footer></section>;}`,
  },
  'request-module-option-keys': { './App.tsx': `let search='unused';
    const user=$fetch('/api/user',{query:{search:'fixed'}});
    export function App(){let n=0;return <main><h1>{user?.name}</h1><button onClick={()=>n++}>{n}</button></main>;}` },
  'request-list-siblings': { './App.tsx': `export function App(){const user=$fetch('/api/user');let n=0;
    return <main><h1>{user?.name}</h1>{user?.rows?.map((item,index)=><li key={item.id}>{index}:{item.label}</li>)}
      <button onClick={()=>n++}>{n}</button>{n}<footer>After</footer></main>;}` },
  'request-nested-list': { './App.tsx': `export function App(){const user=$fetch('/api/user');const request=$track(user);let n=0;let selected='';
    return <main><button class="next" onClick={()=>n++}>Next</button><button class="reload" onClick={()=>request.refresh()}>Reload</button>
      <ul>{user?.groups?.map(group=><li key={group.id} class="group" data-id={group.id}><h2>{group.name}</h2><ol>Before
        {group.rows.map((row,index)=><li key={row.id} class="row" data-id={row.id}><button class="select" onClick={()=>selected=row.label}>{index}:{row.label}:{n}</button></li>)}
        <footer>After {n}</footer></ol></li>)}</ul><p>{selected}</p></main>;}` },
  'composition-recreated-children': {
    './App.tsx': `import {Shell} from './Shell';export function App(){let open=true;let n=1;return <main>
      <button class="toggle" onClick={()=>open=!open}>Toggle</button><button class="next" onClick={()=>n++}>Next</button>
      {open&&<Shell><b>Fixed caller text</b><button class="inside" title={'n'+n} onClick={()=>n++}>{n}</button></Shell>}<p>{n}</p></main>;}`,
    './Shell.tsx': `import {Frame} from './Frame';export function Shell({children}){return <section><h2>Before</h2>{children}<Frame>{children}</Frame></section>;}`,
    './Frame.tsx': `export function Frame({children}){return <aside><i>Prefix</i>{children}<footer>After</footer></aside>;}`,
  },
  'request-list': { './App.tsx': `export function App(){const user=$fetch('/api/user');let suffix='!';return <main>
    <h1>{user?.name}</h1><button onClick={()=>suffix+='!'}>Change</button>
    <ul>{user?.rows?.map((item,index)=><li key={item.id} title={item.label}>{index}:{item.label}{suffix}</li>)}</ul><footer>Kept</footer></main>;}` },
  'request-local-list': { './App.tsx': `export function App(){const user=$fetch('/api/user');let rows=[{id:1,label:'one'},{id:2,label:'two'}];
    return <main><h1>{user?.name}</h1><button onClick={()=>rows=rows.toReversed()}>Reverse</button>
      <ul>{rows.map(row=><li key={row.id}>{row.label}</li>)}</ul><footer>Kept</footer></main>;}` },
  'request-conditional': { './App.tsx': `export function App(){const user=$fetch('/api/user');let show=true;let n=0;
    return <main><h1>{user?.name}</h1><button class="toggle" onClick={()=>show=!show}>Toggle</button>
      <button class="add" onClick={()=>n++}>{n}</button>
      {user?.name==='Ada' && show?<section><h2>{user?.name}:{n}</h2></section>:<p>Hidden {n}</p>}
      <footer>Kept</footer><span>{n}</span></main>;}` },
  'request-local-conditional': { './App.tsx': `export function App(){const user=$fetch('/api/user');let show=true;
    return <main><h1>{user?.name}</h1><button onClick={()=>show=!show}>Toggle</button>
      {show&&<p>Shown</p>}<footer>Kept</footer></main>;}` },
  'request-opaque': { './App.tsx': `import {createDataRuntime} from '@memoized-dom/data';
    export function App(){const api=createDataRuntime();const user=api.$fetch('/api/user');$cleanup(api.clear);
      return <main><p>{user.data?.name}</p></main>;}` },
  'route-helper': { './App.tsx': `import {buildRoutePath} from '@memoized-dom/router';
    export function App(){let id=1;return <main><button onClick={()=>id++}>Next</button>
      <a href={buildRoutePath('/person/:id',{id})}>Person</a></main>;}` },
  'request-group': { './App.tsx': `import {Group} from '@memoized-dom/data';function Pending(){return <p>Loading</p>;}
    export function App(){const user=$fetch('/api/user');return <main><Group pending={Pending}><p>{user?.name}</p></Group></main>;}` },
  'request-inline-group': { './App.tsx': `import {Group} from '@memoized-dom/data';
    export function App(){const user=$fetch('/api/user');let label='Directory';return <main>
      <button class="rename" onClick={()=>label+='!'}>Rename</button>
      <Group pending={()=> <p>{label}:Loading</p>}
        error={({error:failure,retry:again})=> <button class="retry" onClick={again}>{label}:{failure.message}</button>}>
        <h1>{label}:{user?.name}</h1></Group></main>;}` },
  'request-routed-group': { './App.tsx': `import {Group} from '@memoized-dom/data';function Pending(){return <p>Loading</p>;}
    export function App(){const user=$fetch('/api/user');return <main route="/">
      <nav><a class="home" route-to="/">Home</a><a class="about" route-to="/about">About</a></nav>
      <section route="/"><Group pending={Pending}><p>{user?.name}</p></Group></section>
      <section route="/about"><h2>About directory</h2></section></main>;}` },
  'request-rebind': { './App.tsx': `export function App(){let name='Ada';const user=$fetch('/api/user',{query:{name}});
    return <main><button onClick={()=>name=name==='Ada'?'Lin':'Ada'}>Next</button><p>{user?.name}</p></main>;}` },
  'request-factory-rebind': {
    './App.tsx': `import {getUser} from './user';export function App(){let name='Ada';const user=getUser(name);
      return <main><button onClick={()=>name=name==='Ada'?'Lin':'Ada'}>Next</button><p>{user?.name}</p></main>;}`,
    './user.ts': `export function getUser(name:string){return $fetch('/api/user',{query:{name},cache:false});}`,
  },
  'request-data': { './App.tsx': `export function App(){const user=$fetch('/api/user');
    return <main><p>{user?.name}</p></main>;}` },
  'request-encoded-body': { './App.tsx': `export function App(){const user=$fetch('/api/encoded',{method:'POST',body:{name:'Ada'}});
    return <main><p>{user?.name}</p></main>;}` },
  'request-opaque-options': {
    './App.tsx': `import {options} from './options';export function App(){const user=$fetch('/api/encoded',options());return <main><p>{user?.name}</p></main>;}`,
    './options.ts': `export function options(){return {method:'POST' as const,body:{name:'Ada'}};}`,
  },
  'request-markup': { './App.tsx': `export function App(){const user=$fetch('/api/user');
    return <main><p>{user?.name}</p><section>${Array.from({length:16},(_,index)=>
      `<article data-card="${index}"><h2>Card ${index}</h2><p>Ready &amp; waiting.</p></article>`).join('')}</section></main>;}` },
  'promise-data': { './App.tsx': `export function App(){const user=$read(Promise.resolve({name:'Ada'}));
    return <main><p>{user?.name}</p></main>;}` },
  static: { './App.tsx': `export function App(){return <main><h1>Static shell</h1><p>Ready.</p></main>;}` },
  'owner-counter': { './App.tsx': `export function App(){let count=0;return <main>
    <button onClick={()=>count++}>Add</button><p>{count}</p></main>;}` },
  'isolated-counter': {
    './App.tsx': `import './host';export function App(){let count=0;return <main>
      <button onClick={()=>count++}>Add</button><p>{count}</p></main>;}`,
    './host.ts': `import {createApplicationRuntime,setActiveApplicationRuntime} from '@memoized-dom/runtime';
      setActiveApplicationRuntime(createApplicationRuntime('size-fixture',{
        document,schedule:null,effects:'run',refs:'run',
      }));`,
  },
  'input-list': { './App.tsx': `export function App(){let count=0;let items=['helo','heoo3'];let temp='';
    return <main><input placeholder="enter here" value={temp} onInput={(e:any)=>{temp=e.target.value;}}/>
      <ul>{items.map((item,index)=><li key={index}>{index}-{item}</li>)}</ul>
      <button onClick={()=>{if(!temp.trim())return;items=[...items,temp];temp='';}}>Add todo</button></main>;}` },
  'module-counter': { './App.tsx': `let count=0;export function App(){return <main>
    <button onClick={()=>count++}>Add</button><p>{count}</p></main>;}` },
  composition: { './App.tsx': `function Label({value}:{value:number}){return <strong>{value}</strong>;}
    export function App(){let count=0;return <main><h1>Composition</h1>
      <button onClick={()=>count++}>Add</button><Label value={count}/></main>;}` },
  'owner-list': { './App.tsx': `export function App(){let rows=[{id:1,label:'one'},{id:2,label:'two'},{id:3,label:'three'}];
    return <main><button onClick={()=>{rows=rows.toReversed();}}>Reverse</button>
      <ul>{rows.map(row=><li key={row.id}>{row.label}</li>)}</ul></main>;}` },
  'mixed-lists': { './App.tsx': `export function App(){let keyed=[{id:1,label:'one'},{id:2,label:'two'}];let positional=['a','b'];
    return <main><button onClick={()=>{keyed=keyed.toReversed();positional=[...positional,'c'];}}>Change</button>
      <ul class="keyed">{keyed.map(row=><li key={row.id}>{row.label}</li>)}</ul>
      <ul class="positional">{positional.map((item,index)=><li key={index}>{index}:{item}</li>)}</ul></main>;}` },
};
