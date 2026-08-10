export let sales = 20;
export let refunds = 3;

export function recordSale(): void {
  sales++;
}

export function recordRefund(): void {
  refunds++;
}
