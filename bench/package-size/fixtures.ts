/** Stable authored graphs; examples are measured separately and may change. */
export const sizeFixtures: Record<string, Record<string, string>> = {
  'request-list-siblings': { './App.tsx': `export function App(){const user=$fetch('/api/user');let n=0;
    return <main><h1>{user?.name}</h1>{user?.rows?.map((item,index)=><li key={item.id}>{index}:{item.label}</li>)}
      <button onClick={()=>n++}>{n}</button>{n}<footer>After</footer></main>;}` },
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
  'request-routed-group': { './App.tsx': `import {Group} from '@memoized-dom/data';function Pending(){return <p>Loading</p>;}
    export function App(){const user=$fetch('/api/user');return <main route="/">
      <nav><a class="home" route-to="/">Home</a><a class="about" route-to="/about">About</a></nav>
      <section route="/"><Group pending={Pending}><p>{user?.name}</p></Group></section>
      <section route="/about"><h2>About directory</h2></section></main>;}` },
  'request-data': { './App.tsx': `export function App(){const user=$fetch('/api/user');
    return <main><p>{user?.name}</p></main>;}` },
  'request-markup': { './App.tsx': `export function App(){const user=$fetch('/api/user');
    return <main><p>{user?.name}</p><section>${Array.from({length:16},(_,index)=>
      `<article data-card="${index}"><h2>Card ${index}</h2><p>Ready &amp; waiting.</p></article>`).join('')}</section></main>;}` },
  'promise-data': { './App.tsx': `export function App(){const user=$read(Promise.resolve({name:'Ada'}));
    return <main><p>{user?.name}</p></main>;}` },
  static: { './App.tsx': `export function App(){return <main><h1>Static shell</h1><p>Ready.</p></main>;}` },
  'owner-counter': { './App.tsx': `export function App(){let count=0;return <main>
    <button onClick={()=>count++}>Add</button><p>{count}</p></main>;}` },
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
