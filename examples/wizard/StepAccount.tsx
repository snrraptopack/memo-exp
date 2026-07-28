import type { AccountData } from './wizard-db';

export interface StepAccountProps {
  data: AccountData;
  onUpdate: (field: keyof AccountData, value: string) => void;
  onNext: () => void;
}

export function StepAccount({ data, onUpdate, onNext }: StepAccountProps) {
  const isValid = data.fullName.trim().length > 0 && data.email.includes('@');

  return (
    <div class="step-card">
      <h2>Step 1: Account Information</h2>

      <div class="form-group">
        <label>Full Name</label>
        <input
          type="text"
          value={data.fullName}
          onInput={(e: any) => onUpdate('fullName', e.target.value)}
        />
      </div>

      <div class="form-group">
        <label>Email Address</label>
        <input
          type="email"
          value={data.email}
          onInput={(e: any) => onUpdate('email', e.target.value)}
        />
      </div>

      <div class="step-actions">
        <button class="btn primary" disabled={!isValid} onClick={onNext}>
          Continue to Shipping →
        </button>
      </div>
    </div>
  );
}
