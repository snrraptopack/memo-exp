     	// Fixture: R7 inline list rows — the select-list shape written as plain TSX.
     	// 'selected' is read inside row JSX (row pattern) and written by row
     	// handlers (commitWrites — rows are multi-instance, never local).
     	// 'items.push' routes as a write to 'items' → local markDirty on the owner.
     	let items = [
     	  { id: 1, label: 'one' },
     	  { id: 2, label: 'two' },
     	];
     	let selected = 0;

    	export function InlineList() {
    	  const add = () => {
  	    items.push({ id: items.length + 1, label: 'three' });
    	  };
    	  return (
    	    <div>
    	      <ul>
    	        {items.map((item) => (
    	          <li
    	            key={item.id}
    	            class={selected === item.id ? 'danger' : ''}
    	            onClick={() => {
    	              selected = item.id;
    	            }}
    	          >
  	            {item.label}
    	          </li>
    	        ))}
    	      </ul>
    	      <button onClick={add}>add</button>
    	      </div>);}
