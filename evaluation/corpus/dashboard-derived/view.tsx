import { recordRefund, recordSale } from './state';
import { net } from './summary';

export function Dashboard() {
  return <section><button onClick={() => recordSale()}>sale</button><button onClick={() => recordRefund()}>refund</button><output>{net}</output></section>;
}
