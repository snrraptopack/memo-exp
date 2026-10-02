/** Authored TSX sources for equal-result mutable/immutable list workloads. */
import type { RowStyle, StatePlacement, UpdateStyle } from './state-placement-matrix';

export function updateStyleSource(placement: StatePlacement, rows: RowStyle, style: UpdateStyle, rootName = 'App'): string {
  const data = 'let data = [];', selection = 'let selected = null;';
  const ownerSelection = placement.selectionOwned;
  const selectedRead = ownerSelection && rows === 'component' ? 'isSelected' : 'selected === item.id';
  const select = ownerSelection ? 'select(item.id)' : 'selected = item.id';
  const component = `function Row({item${ownerSelection ? ', isSelected, select' : ''}}) {
    return <li class={${selectedRead} ? 'danger' : ''} onClick={() => {${select};}}>{item.id}: {item.label}</li>;
  }`;
  const row = rows === 'inline'
    ? `<li key={item.id} class={selected === item.id ? 'danger' : ''} onClick={() => {${select};}}>{item.id}: {item.label}</li>`
    : `<Row key={item.id} item={item}${ownerSelection ? ' isSelected={selected === item.id} select={select}' : ''}/>`;
  const operations = style === 'mutable' ? {
    update: `for (let i=0; i<data.length; i+=10) data[i].label += ' !!!';`,
    swap: `const first = data[1]; data[1] = data[998]; data[998] = first;`,
    append1k: `data.push(...buildData(1000));`,
    remove: `data.splice(500,1);`,
  } : {
    update: `data = data.map((item,index) => index % 10 === 0 ? {...item,label:item.label + ' !!!'} : item);`,
    swap: `data = data.map((item,index) => index === 1 ? data[998] : index === 998 ? data[1] : item);`,
    append1k: `data = data.concat(buildData(1000));`,
    remove: `data = data.filter((_item,index) => index !== 500);`,
  };
  return `import {buildData} from '../../data';
    ${placement.dataOwned ? '' : data} ${ownerSelection ? '' : selection}
    ${rows === 'component' ? component : ''}
    export function ${rootName}() {
      ${placement.dataOwned ? data : ''} ${ownerSelection ? selection + ' const select = id => {selected = id;};' : ''}
      return <main><nav>
        <button onClick={() => {data = buildData(1000); selected = null;}}>create1k</button>
        <button onClick={() => {data = buildData(10000); selected = null;}}>create10k</button>
        <button onClick={() => {data = []; selected = null;}}>clear</button>
        ${Object.entries(operations).map(([name,body]) => `<button onClick={() => {${body}}}>${name}</button>`).join('')}
      </nav><ul>{data.map(item => ${row})}</ul></main>;
    }`;
}
