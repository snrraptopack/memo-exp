import { INITIAL_WIZARD_STATE, type WizardState, type AccountData, type ShippingData } from './wizard-db';
import { StepAccount } from './StepAccount';
import { StepShipping } from './StepShipping';
import { StepPayment } from './StepPayment';

export function WizardApp() {
  // Component Instance State
  let wizardState: WizardState = { ...INITIAL_WIZARD_STATE };
  let currentStep = 1;
  let flowStatus = 'editing';

  // Derivation
  const stepProgress = `Step ${currentStep} of 3`;

  // Value-Guarded Effect: fires only when stepProgress changes!
  effect(() => {
    console.log('[Wizard Progress Effect]', stepProgress, 'Status:', flowStatus);
  });

  // Early Return Control Flow 1: Submitting State
  if (flowStatus === 'submitting') {
    return (
      <div class="wizard-status-card">
        <div class="spinner"></div>
        <h2>Processing Your Order...</h2>
        <p>Connecting to secure payment gateway.</p>
      </div>
    );
  }

  // Early Return Control Flow 2: Complete State
  if (flowStatus === 'complete') {
    return (
      <div class="wizard-status-card success">
        <div class="success-icon">🎉</div>
        <h2>Order Confirmed!</h2>
        <p>Thank you, <strong>{wizardState.account.fullName}</strong>. A confirmation email was sent to <strong>{wizardState.account.email}</strong>.</p>
        <button
          class="btn primary"
          onClick={() => {
            wizardState = { ...INITIAL_WIZARD_STATE };
            flowStatus = 'editing';
            currentStep = 1;
          }}
        >
          Start New Wizard Flow
        </button>
      </div>
    );
  }

  // Pure Switch Prelude (R27)
  let stepTitle = '';
  switch (currentStep) {
    case 1:
      stepTitle = '1. Account Information';
      break;
    case 2:
      stepTitle = '2. Shipping Address';
      break;
    case 3:
      stepTitle = '3. Review & Payment';
      break;
  }

  // Event Handlers
  const handleUpdateAccount = (field: keyof AccountData, value: string) => {
    wizardState = {
      ...wizardState,
      account: { ...wizardState.account, [field]: value },
    };
  };

  const handleUpdateShipping = (field: keyof ShippingData, value: string) => {
    wizardState = {
      ...wizardState,
      shipping: { ...wizardState.shipping, [field]: value },
    };
  };

  const handleSubmitOrder = () => {
    flowStatus = 'submitting';
    setTimeout(() => {
      flowStatus = 'complete';
    }, 1500);
  };

  return (
    <div class="wizard-app-container">
      <header class="wizard-header">
        <h1>🧙‍♂️ Memoized DOM Checkout Wizard</h1>
        <p class="step-title">{ stepTitle}</p>
        <p class="subtitle">Demonstrating <strong>R27 Prelude Replay</strong>, <strong>Early Returns</strong>, and <strong>Prop Callback Mutations</strong>.</p>

        <div class="wizard-progress-bar">
          <div class={`progress-step ${currentStep >= 1 ? 'active' : ''}`}>1. Account</div>
          <div class={`progress-step ${currentStep >= 2 ? 'active' : ''}`}>2. Shipping</div>
          <div class={`progress-step ${currentStep >= 3 ? 'active' : ''}`}>3. Payment</div>
        </div>
      </header>

      <main class="wizard-main">
        {currentStep === 1 ? (
          <StepAccount
            data={wizardState.account}
            onUpdate={handleUpdateAccount}
            onNext={() => { currentStep = 2; }}
          />
        ) : currentStep === 2 ? (
          <StepShipping
            data={wizardState.shipping}
            onUpdate={handleUpdateShipping}
            onBack={() => { currentStep = 1; }}
            onNext={() => { currentStep = 3; }}
          />
        ) : (
          <StepPayment
            state={wizardState}
            onBack={() => { currentStep = 2; }}
            onSubmit={handleSubmitOrder}
          />
        )}
      </main>
    </div>
  );
}
