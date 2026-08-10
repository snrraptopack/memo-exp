export const counter = { value: 0 };

export function write(target: { value: number }): void {
  target.value++;
}

export function layer1(target: { value: number }): void {
  write(target);
}

export function increment(): void {
  layer1(counter);
}
