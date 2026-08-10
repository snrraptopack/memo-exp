import { change as runChange, sharedModel as data } from './bridge';

export function Reexported() {
  return <button onClick={() => runChange()}>{data.value}</button>;
}
