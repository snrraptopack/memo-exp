export const diagnosticCodes = {
  preferConst: 98001,
} as const;

export const diagnosticSource = 'memoized-dom';

export function preferConstMessage(names: readonly string[]): string {
  const binding =
    names.length === 1
      ? `'${names[0]}' is`
      : `Bindings ${names.map((name) => `'${name}'`).join(', ')} are`;
  return (
    `${binding} never reassigned. Use const; memoized-dom reactivity follows ` +
    'state reads and assignments, not let declarations. const arrays and ' +
    'objects may still mutate their contents.'
  );
}
