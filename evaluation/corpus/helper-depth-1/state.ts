export const counter = { value: 0 };

export function write(target: { value: number }): void {
  target.value++;
}

export function increment(): void {
  write(counter);
}
