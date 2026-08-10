import { reprice, restock } from './helpers';
import { inventory } from './state';

export function restockPens(): void { restock(inventory.pens, 5); }
export function repriceBooks(): void { reprice(inventory.books, 18); }
export function selectBooks(): void { inventory.selected = 'books'; }
