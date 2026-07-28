export interface AccountData {
  fullName: string;
  email: string;
}

export interface ShippingData {
  address: string;
  city: string;
  zipCode: string;
}

export interface PaymentData {
  cardNumber: string;
  expDate: string;
}

export interface WizardState {
  account: AccountData;
  shipping: ShippingData;
  payment: PaymentData;
}

export const INITIAL_WIZARD_STATE: WizardState = {
  account: { fullName: 'Alex Rivera', email: 'alex@example.com' },
  shipping: { address: '742 Evergreen Terrace', city: 'Springfield', zipCode: '97477' },
  payment: { cardNumber: '4532 •••• •••• 8892', expDate: '12/28' },
};
