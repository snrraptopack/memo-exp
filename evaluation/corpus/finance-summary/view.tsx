import { chooseEuro, depositChecking, updateRate, withdrawSavings } from './actions';
import { displayedTotal } from './converted';
import { accounts } from './state';

export function FinanceSummary() {
  return <section><button onClick={() => depositChecking(100)}>deposit</button><button onClick={() => withdrawSavings(50)}>withdraw</button><button onClick={() => chooseEuro()}>currency</button><button onClick={() => updateRate(0.92)}>rate</button><output>{accounts.currency}:{displayedTotal}</output></section>;
}
