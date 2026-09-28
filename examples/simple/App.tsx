

export function App() {
  let items = ['helo', 'heoo3']
  let temp = ''
  return (
    <>
      <input placeholder="enter here" value={temp} onInput={(e: any) => (temp = e.target.value)} />
      {items.map((item, index) => <li>{index}-{item}</li>)}
      <button onClick={() => {
        if(!temp.trim()) return
        items = [...items,temp] // tems.push is the idomatic way
        temp = ''
      }}>Add Todo</button>
    </>
  )
}

/**
 * marko example
 * <let/count=0>
 <let/items=['helo','heoo3']>
 <let/temp=''>

 <input placeholder="enter here" value=temp onInput(e){
   temp = e.target.value
 }/>

 <for|item, index| of=items>
   <li>${index}-${item}</li>
 </for>
 <button onClick() {
   if(!temp.trim()) return
   items = [...items,temp]
   temp = ''
 }>
  Add todo
 </button>

 */
