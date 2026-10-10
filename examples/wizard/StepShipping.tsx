import type { ShippingData } from './wizard-db';

export interface StepShippingProps {
  data: ShippingData;
  onUpdate: (field: keyof ShippingData, value: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function StepShipping({ data, onUpdate, onBack, onNext }: StepShippingProps) {
  const isValid = data.address.trim().length > 0 && data.city.trim().length > 0;

  return (
    <div class="step-card">
      <h2>Step 2: Shipping Address</h2>

      <div class="form-group">
        <label>Street Address</label>
        <input
          type="text"
          value={data.address}
          onInput={e => onUpdate('address', e.currentTarget.value)}
        />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>City</label>
          <input
            type="text"
            value={data.city}
            onInput={e => onUpdate('city', e.currentTarget.value)}
          />
        </div>

        <div class="form-group">
          <label>ZIP Code</label>
          <input
            type="text"
            value={data.zipCode}
            onInput={e => onUpdate('zipCode', e.currentTarget.value)}
          />
        </div>
      </div>

      <div class="step-actions">
        <button class="btn secondary" onClick={onBack}>← Back</button>
        <button class="btn primary" disabled={!isValid} onClick={onNext}>
          Continue to Payment →
        </button>
      </div>
    </div>
  );
}
