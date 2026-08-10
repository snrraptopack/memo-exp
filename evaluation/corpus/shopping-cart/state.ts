export interface Item { id: number; title: string; price: number }

export const cart = { items: [] as Item[], discount: 0 };

export function add(item: Item): void {
  cart.items.push(item);
}

export function remove(index: number): void {
  cart.items.splice(index, 1);
}

export function setDiscount(value: number): void {
  cart.discount = value;
}
