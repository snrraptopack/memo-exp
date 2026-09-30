export function fieldValue(event: Event): string {
  return (
    event.currentTarget as
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ).value;
}
export function fieldChecked(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}
