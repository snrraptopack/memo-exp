/** Authored TSX shared by timing and compiler-artifact verification. */
export function ownerReorderSource(count: number, mutableContent: boolean): string {
  const records = Array.from({ length: count }, (_, id) => `{id:${id},label:'row ${id}'}`).join(',');
  const reversed = Array.from({ length: count }, (_, index) => `items[${count - index - 1}]`).join(',');
  const rotated = Array.from({ length: count }, (_, index) => `items[${(index + 1) % count}]`).join(',');
  return `export function App(){let items=[${records}];return <main>
    <button onClick={()=>{items=[${reversed}]}}>reverse</button>
    <button onClick={()=>{items=[${rotated}]}}>rotate</button>
    ${mutableContent ? "<button onClick={()=>{items[0].label=items[0].label+'!'}}>rename</button>" : ''}
    <ul>{items.map(item=><li key={item.id}><span>{item.id}</span><span>: {item.label}</span></li>)}</ul>
  </main>;}`;
}
