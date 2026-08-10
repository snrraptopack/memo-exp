import * as state from './state';

export function NamespaceView() {
  return <button onClick={() => state.update()}>{state.model.value}</button>;
}
