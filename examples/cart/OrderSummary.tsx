export interface OrderSummaryProps {
  subtotal: number;
  discount: number;
  shippingCost: number;
  grandTotal: number;
  promoCode: string;
  shippingMethod: string;
  onApplyPromo: (code: string) => void;
  onSelectShipping: (method: string) => void;
}

export function OrderSummary({
  subtotal,
  discount,
  shippingCost,
  grandTotal,
  promoCode,
  shippingMethod,
  onApplyPromo,
  onSelectShipping,
}: OrderSummaryProps) {
  const isPromoApplied = promoCode === 'MEMO15';

  return (
    <div class="order-summary-card">
      <h2>Order Summary</h2>
      
      <div class="summary-row">
        <span>Subtotal</span>
        <span>${subtotal}</span>
      </div>

      <div class="summary-row">
        <span>Shipping ({shippingMethod})</span>
        <span>${shippingCost}</span>
      </div>

      {discount > 0 ? (
        <div class="summary-row discount">
          <span>Promo Discount (MEMO15 - 15%)</span>
          <span>-${discount.toFixed(2)}</span>
        </div>
      ) : null}

      <div class="summary-divider"></div>

      <div class="summary-row total">
        <span>Grand Total</span>
        <span>${grandTotal.toFixed(2)}</span>
      </div>

      {/* Shipping Selector */}
      <div class="shipping-section">
        <label>Shipping Method:</label>
        <div class="shipping-options">
          <button
            class={shippingMethod === 'standard' ? 'shipping-btn active' : 'shipping-btn'}
            onClick={() => onSelectShipping('standard')}
          >
            Standard ($5)
          </button>
          <button
            class={shippingMethod === 'express' ? 'shipping-btn active' : 'shipping-btn'}
            onClick={() => onSelectShipping('express')}
          >
            Express ($15)
          </button>
        </div>
      </div>

      {/* Promo Code Section */}
      <div class="promo-section">
        <button
          class="promo-btn"
          onClick={() => onApplyPromo(isPromoApplied ? '' : 'MEMO15')}
        >
          {isPromoApplied ? '❌ Remove Promo Code (MEMO15)' : '🏷️ Apply 15% Promo Code (MEMO15)'}
        </button>
      </div>
    </div>
  );
}
