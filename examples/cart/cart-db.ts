export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  icon: string;
}

export interface CartItemData extends Product {
  qty: number;
}

export const INITIAL_PRODUCTS: CartItemData[] = [
  { id: 101, name: 'Memoized Compiler Spec', category: 'DevTools', price: 49, qty: 1, icon: '⚡' },
  { id: 102, name: 'Zero-VDOM Runtime License', category: 'Runtime', price: 99, qty: 2, icon: '🚀' },
  { id: 103, name: 'Static AST Optimization Guide', category: 'Books', price: 29, qty: 1, icon: '📖' },
  { id: 104, name: 'Hygienic UID Allocator Badge', category: 'DevTools', price: 15, qty: 1, icon: '🛡️' },
];
