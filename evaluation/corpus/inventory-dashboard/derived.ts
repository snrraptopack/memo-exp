import { inventory } from './state';

export const penValue = inventory.pens.quantity * inventory.pens.price;
export const bookValue = inventory.books.quantity * inventory.books.price;
export const totalValue = penValue + bookValue;
