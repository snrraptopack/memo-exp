/** Existing JSX value normalization without rendering-host dependencies. */

type ClassRecord = Record<string, unknown>;

export function textValue(value: unknown): string {
  return value == null || typeof value === 'boolean' ? '' : String(value);
}

/** Normalize strings, nested arrays, and conditional class objects. */
export function classValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const names: string[] = [];
  appendClass(value, names);
  return names.join(' ');
}

function appendClass(value: unknown, names: string[]): void {
  if (value == null || value === false || value === true) return;
  if (Array.isArray(value)) {
    for (const item of value) appendClass(item, names);
    return;
  }
  if (typeof value === 'object') {
    for (const [name, enabled] of Object.entries(value as ClassRecord)) {
      if (enabled) names.push(name);
    }
    return;
  }
  const text = String(value).trim();
  if (text !== '') names.push(text);
}
