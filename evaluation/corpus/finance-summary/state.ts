export const accounts = {
  checking: 1000,
  savings: 5000,
  currency: 'USD' as 'USD' | 'EUR',
};

export let usdToEur = 0.9;

export function setRate(rate: number): void {
  usdToEur = rate;
}
