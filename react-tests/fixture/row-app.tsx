import { RowList } from 'row-kit';

function More() {
  return <><i>M</i><i>N</i></>;
}

export function App() {
  let count = 0;
  return <main>
    <RowList><button onClick={() => count++}>{count}</button><span>fixed</span></RowList>
    <RowList><em>other</em></RowList>
    <RowList>{null}</RowList>
    <RowList>{null}<span>tail</span></RowList>
    <RowList><><b>X</b><b>Y</b></></RowList>
    <RowList><More /></RowList>
  </main>;
}
