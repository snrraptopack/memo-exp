import type { CartItemData } from './cart-db';
import { CartItemRow } from './CartItemRow';

export interface CartListProps {
  items: CartItemData[];
  onUpdateQty: (id: number, delta: number) => void;
  onRemoveItem: (id: number) => void;
}

export function CartList({ items, onUpdateQty, onRemoveItem }: CartListProps) {
  return (
    <ul class="cart-list">
      {items.map((item) => (
        <CartItemRow
          key={item.id}
          item={item}
          onUpdateQty={onUpdateQty}
          onRemoveItem={onRemoveItem}
        />
      ))}
    </ul>
  );
}
