import {
  compilerDiagnosticCode,
  compilerDiagnosticSource as diagnosticSource,
} from '@memoized-dom/compiler';
export { compilerDiagnosticCode, diagnosticSource };

export const diagnosticCodes = {
  compiler: compilerDiagnosticCode,
  preferConst: 98001,
} as const;

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
