export const counter = { value: 0 };

export function write(target: { value: number }): void {
  target.value++;
}

export function layer1(target: { value: number }): void { write(target); }
export function layer2(target: { value: number }): void { layer1(target); }
export function layer3(target: { value: number }): void { layer2(target); }

export function increment(): void {
  layer3(counter);
}
