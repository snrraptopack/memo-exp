import type { WizardState } from './wizard-db';

export interface StepPaymentProps {
  state: WizardState;
  onBack: () => void;
  onSubmit: () => void;
}

export function StepPayment({ state, onBack, onSubmit }: StepPaymentProps) {
  return (
    <div class="step-card">
      <h2>Step 3: Review & Submit Order</h2>

      <div class="review-section">
        <h3>Account Summary</h3>
        <p><strong>Name:</strong> {state.account.fullName}</p>
        <p><strong>Email:</strong> {state.account.email}</p>
      </div>

      <div class="review-section">
        <h3>Shipping Destination</h3>
        <p><strong>Address:</strong> {state.shipping.address}, {state.shipping.city} {state.shipping.zipCode}</p>
      </div>

      <div class="review-section">
        <h3>Payment Method</h3>
        <p><strong>Card:</strong> {state.payment.cardNumber} (Exp: {state.payment.expDate})</p>
      </div>

      <div class="step-actions">
        <button class="btn secondary" onClick={onBack}>← Back</button>
        <button class="btn success" onClick={onSubmit}>
          🔒 Confirm & Submit Order
        </button>
      </div>
    </div>
  );
}
