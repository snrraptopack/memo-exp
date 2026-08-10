import { accounts, setRate } from './state';

export function depositChecking(amount: number): void { accounts.checking += amount; }
export function withdrawSavings(amount: number): void { accounts.savings -= amount; }
export function chooseEuro(): void { accounts.currency = 'EUR'; }
export function updateRate(rate: number): void { setRate(rate); }
