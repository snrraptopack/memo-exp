/** Stable authored graphs; examples are measured separately and may change. */
export const sizeFixtures: Record<string, Record<string, string>> = {
  'request-data': { './App.tsx': `export function App(){const user=$fetch('/api/user');
    return <main><p>{user?.name}</p></main>;}` },
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
};
