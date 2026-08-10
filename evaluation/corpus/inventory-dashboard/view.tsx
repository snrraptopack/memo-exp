import { repriceBooks, restockPens, selectBooks } from './actions';
import { totalValue } from './derived';
import { inventory } from './state';

export function InventoryDashboard() {
  return <section><button onClick={() => restockPens()}>restock</button><button onClick={() => repriceBooks()}>reprice</button><button onClick={() => selectBooks()}>select</button><output>{inventory.selected}:{totalValue}</output></section>;
}
