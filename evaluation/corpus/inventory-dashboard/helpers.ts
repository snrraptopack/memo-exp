export function restock(item: { quantity: number }, amount: number): void {
  item.quantity += amount;
}

export function reprice(item: { price: number }, price: number): void {
  item.price = price;
}
