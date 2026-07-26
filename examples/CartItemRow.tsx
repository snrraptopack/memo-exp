import type { CartItemData } from './cart-db';

export interface CartItemRowProps {
  item: CartItemData;
  onUpdateQty: (id: number, delta: number) => void;
  onRemoveItem: (id: number) => void;
}

export function CartItemRow({ item, onUpdateQty, onRemoveItem }: CartItemRowProps) {
  const lineTotal = item.price * item.qty;

  return (
    <li class="cart-item-row">
      <div class="item-info">
        <span class="item-icon">{item.icon}</span>
        <div class="item-details">
          <span class="item-name">{item.name}</span>
          <span class="item-meta">${item.price} each • {item.category}</span>
        </div>
      </div>
      
      <div class="item-controls">
        <div class="qty-picker">
          <button class="btn-qty" onClick={() => onUpdateQty(item.id, -1)}>-</button>
          <span class="qty-val">{item.qty}</span>
          <button class="btn-qty" onClick={() => onUpdateQty(item.id, 1)}>+</button>
        </div>
        <span class="line-total">${lineTotal}</span>
        <button class="btn-remove" onClick={() => onRemoveItem(item.id)}>🗑️</button>
      </div>
    </li>
  );
}
