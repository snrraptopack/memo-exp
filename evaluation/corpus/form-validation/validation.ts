export function touch(field: { touched: boolean }): void {
  field.touched = true;
}

export function normalize(field: { value: string }): void {
  field.value = field.value.trim();
}

export function prepare(field: { value: string; touched: boolean }): void {
  normalize(field);
  touch(field);
}
