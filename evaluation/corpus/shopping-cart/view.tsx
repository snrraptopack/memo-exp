import { add, cart, remove, setDiscount } from './state';

export function Cart() {
  return <section><button onClick={() => add({ id: 1, title: 'Book', price: 20 })}>add</button><button onClick={() => remove(0)}>remove</button><button onClick={() => setDiscount(5)}>discount</button><output>{cart.items.length}:{cart.discount}</output></section>;
}
