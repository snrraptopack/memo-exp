/** Closed authored producers isolate helper-return precision from runtime changes. */
export function helperComparisonSources(count = 10000): Record<string, string> {
  const records = Array.from({ length: count }, (_, index) => `{id:${index + 1},label:'row ${index + 1}'}`).join(',');
  return {
    './rows.ts': `export function createRows(){return [${records}];}
      export function reverse(rows){return rows.toReversed();}
      export function rotate(rows,count){const tail=rows.slice(count);return tail.concat(rows.slice(0,count));}
      export function drop(rows){return rows.slice(0,rows.length-1);}`,
    './bridge.ts': `import {reverse as flip,rotate,drop,createRows} from './rows';
      export function reverse(rows){return flip(rows);}export {rotate,drop,createRows};`,
    './App.tsx': `import {reverse,rotate,drop,createRows} from './bridge';
      export function App(){let items=createRows();let selected=500;
        return <main><button id="fresh" onClick={()=>{items=createRows();}}>fresh</button>
          <button id="reverse" onClick={()=>{items=reverse(items);}}>reverse</button>
          <button id="rotate" onClick={()=>{items=rotate(items,1);}}>rotate</button>
          <button id="drop" onClick={()=>{items=drop(items);}}>drop</button>
          <button id="mixed" onClick={()=>{items=reverse(items);selected=501;}}>mixed</button>
          <ul>{items.map(row=><li key={row.id} data-id={row.id} class={selected===row.id?'danger':''}>{row.label}</li>)}</ul>
        </main>;}`,
  };
}
