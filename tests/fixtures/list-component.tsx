     	// Fixture: R7 component list rows — a Row component used via .map().
     	// Row reads 'selected' directly (the L1 rule: props are for item data,
     	// shared state is read inside the row), so a click must dirty ALL rows
     	// through the table's 'App/CompList/items/Row[*]' pattern.
     	let items = [
     	  { id: 1, label: 'one' },
     	  { id: 2, label: 'two' },
     	];
     	let selected = 0;

    	function Row(item: { id: number; label: string }) {
    	  return (
    	    <li
    	      class={selected === item.id ? 'danger' : ''}
    	      onClick={() => {
    	        selected = item.id;
    	      }}
    	    >
    	      {item.label}
    	    </li>
    	  );
    	}

    	export function CompList() {
    	  const add = () => {
    	    items.push({ id: items.length + 1, label: 'three' });
    	  };
    	  return (
    	    <div>
    	      <ul>{items.map((item) => <Row key={item.id} item={item} />)}</ul>
    	      <button onClick={add}>add</button>
    	    </div>
    	  );
    	}
