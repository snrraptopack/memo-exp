import { buildData, updateRows, swapRows, shuffleRows, removeRow, type Row } from './model';

// Component-owned state and inline keyed rows, with the same immutable array
// operations as Octane's tuned JSX/TSRX fixtures. Compiled by memoized-dom.
export function OctaneBench() {
  let items: Row[] = [];
  let selected = 0;
  const run = () => { items = buildData(1000); };
  const runLots = () => { items = buildData(10000); };
  const add = () => { items = items.concat(buildData(1000)); };
  const update = () => { items = updateRows(items); };
  const clear = () => { items = []; };
  const swap = () => { items = swapRows(items); };
  const select = (id: number) => { selected = id; };
  const remove = (row: Row) => { items = removeRow(items, row); };
  const reverse = () => { items = items.toReversed(); };
  const shuffle = () => { items = shuffleRows(items); };
  const rotateForward = () => { items = items.length === 0 ? items : [items[items.length - 1], ...items.slice(0, -1)]; };
  const rotateBackward = () => { items = items.length === 0 ? items : [...items.slice(1), items[0]]; };
  const prepend100 = () => { items = buildData(100).concat(items); };
  const append100 = () => { items = items.concat(buildData(100)); };
  const insertMid100 = () => {
    const middle = items.length >> 1;
    items = items.slice(0, middle).concat(buildData(100), items.slice(middle));
  };
  const removeFirst = () => { items = items.slice(1); };
  const removeEvery10 = () => { items = items.filter((_, index) => index % 10 !== 0); };
  const displace = (count: number) => { items = items.slice(count).concat(items.slice(0, count)); };

  return <div class="container">
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>memoized-dom</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="run" onClick={run}>Create 1,000 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="runlots" onClick={runLots}>Create 10,000 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="add" onClick={add}>Append 1,000 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="update" onClick={update}>Update every 10th row</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="clear" onClick={clear}>Clear</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="swaprows" onClick={swap}>Swap Rows</button></div>
      </div><div class="row">
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="reverse" onClick={reverse}>Reverse rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="shuffle" onClick={shuffle}>Shuffle rows (seeded)</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="rotatef" onClick={rotateForward}>Rotate last to front</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="rotateb" onClick={rotateBackward}>Rotate first to end</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="prepend100" onClick={prepend100}>Prepend 100 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="append100" onClick={append100}>Append 100 rows</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="insertmid100" onClick={insertMid100}>Insert 100 rows at middle</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="removefirst" onClick={removeFirst}>Remove first row</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="removeevery10" onClick={removeEvery10}>Remove every 10th row</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="displace3" onClick={() => displace(3)}>Displace first 3 to end</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="displace4" onClick={() => displace(4)}>Displace first 4 to end</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="displace5" onClick={() => displace(5)}>Displace first 5 to end</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="displace6" onClick={() => displace(6)}>Displace first 6 to end</button></div>
        <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="displace8" onClick={() => displace(8)}>Displace first 8 to end</button></div>
      </div></div>
    </div></div>
    <table class="table table-hover table-striped test-data"><tbody>
      {items.map(row => <tr key={row.id} class={selected === row.id ? 'danger' : ''}>
        <td class="col-md-1">{row.id}</td>
        <td class="col-md-4"><a onClick={() => select(row.id)}>{row.label}</a></td>
        <td class="col-md-1"><a onClick={() => remove(row)}><span class="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
        <td class="col-md-6" />
      </tr>)}
    </tbody></table>
    <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
  </div>;
}
