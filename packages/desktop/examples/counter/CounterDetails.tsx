import type {} from '@memoized-dom/compiler/jsx';
import './app.css';

function CounterSummary(props: { count: number; value: string }) {
  return <>
    <p id="child-summary">Inherited props: count {props.count}, text {props.value}</p>
    <p id="child-fragment-end">Two authored roots share this component owner.</p>
  </>;
}

export function CounterDetails({ count, value }: { count: number; value: string }) {
  let clicks = 0;
  return <section id="child-card" class="counter">
    <h2>Independent child component</h2>
    <p>Received count: {count}</p>
    <p>Received text: {value}</p>
    <button onClick={() => clicks++}>Local clicks: {clicks}</button>
    <CounterSummary count={count} value={value} />
  </section>;
}
