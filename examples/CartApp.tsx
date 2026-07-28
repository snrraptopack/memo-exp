import { getEventLog } from '@memoized-dom/runtime';
import { INITIAL_PRODUCTS, type CartItemData } from './cart-db';
import { CartList } from './CartList';
import { OrderSummary } from './OrderSummary';

export function CartApp() {
  // Component-Local State (R12 - Instance Closure State)
  let items: CartItemData[] = [...INITIAL_PRODUCTS];
  let promoCode = '';
  let shippingMethod = 'standard';
  let categoryFilter = 'ALL';

  effect(()=> console.log(getEventLog(), items.length))

  // Local Derivations (R14 - Owner Update Prologue Replay)
  const filteredItems = categoryFilter === 'ALL'
    ? items
    : items.filter((item) => item.category === categoryFilter);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discount = promoCode === 'MEMO15' ? subtotal * 0.15 : 0;
  const shippingCost = shippingMethod === 'express' ? 15 : 5;
  const grandTotal = subtotal - discount + shippingCost;

  // Local Event Handlers
  const handleUpdateQty = (id: number, delta: number) => {
    items = items.map((item) => {
      if (item.id === id) {
        const newQty = Math.max(1, item.qty + delta);
        return { ...item, qty: newQty };
      }
      return item;
    });
  };

  const handleRemoveItem = (id: number) => {
    items = items.filter((item) => item.id !== id);
  };

  const handleAddItem = () => {
    const newId = Date.now();
    const newItem: CartItemData = {
      id: newId,
      name: `Custom Dev Item #${items.length + 1}`,
      category: 'DevTools',
      price: 35,
      qty: 1,
      icon: '🛠️',
    };
    items = [...items, newItem];
  };

  return (
    <div class="cart-app-container">
      <header class="app-header">
        <h1>🛒 Memoized DOM E-Commerce Cart</h1>
        <p class="app-subtitle">
          Built with <strong>Component-Local State</strong>, <strong>Destructured Props</strong>, and <strong>R14 Local Derivations</strong>.
        </p>

        {/* Category Filter Controls */}
        <div class="category-filters">
          <button
            class={categoryFilter === 'ALL' ? 'filter-btn active' : 'filter-btn'}
            onClick={() => { categoryFilter = 'ALL'; }}
          >
            All Items ({items.length})
          </button>
          <button
            class={categoryFilter === 'DevTools' ? 'filter-btn active' : 'filter-btn'}
            onClick={() => { categoryFilter = 'DevTools'; }}
          >
            DevTools
          </button>
          <button
            class={categoryFilter === 'Runtime' ? 'filter-btn active' : 'filter-btn'}
            onClick={() => { categoryFilter = 'Runtime'; }}
          >
            Runtime
          </button>
          <button
            class={categoryFilter === 'Books' ? 'filter-btn active' : 'filter-btn'}
            onClick={() => { categoryFilter = 'Books'; }}
          >
            Books
          </button>
          <button class="add-item-btn" onClick={handleAddItem}>
            ➕ Add Item
          </button>
        </div>
      </header>

      <main class="cart-layout">
        <section class="cart-main">
          <CartList
            items={filteredItems}
            onUpdateQty={handleUpdateQty}
            onRemoveItem={handleRemoveItem}
          />
        </section>

        <aside class="cart-sidebar">
          <OrderSummary
            subtotal={subtotal}
            discount={discount}
            shippingCost={shippingCost}
            grandTotal={grandTotal}
            promoCode={promoCode}
            shippingMethod={shippingMethod}
            onApplyPromo={(code) => { promoCode = code; }}
            onSelectShipping={(method) => { shippingMethod = method; }}
          />
        </aside>
      </main>
    </div>
  );
}
