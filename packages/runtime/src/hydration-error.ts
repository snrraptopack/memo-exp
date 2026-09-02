/** Structural skew between server markup and the compiled client tree. */
export class HydrationMismatchError extends Error {
  readonly boundary: string;
  readonly expected: string;
  readonly actual: string;

  constructor(boundary: string, expected: string, actual: string) {
    super(
      `memoized-dom: hydration mismatch in '${boundary}': expected ${expected}, found ${actual}`,
    );
    this.name = 'HydrationMismatchError';
    this.boundary = boundary;
    this.expected = expected;
    this.actual = actual;
  }
}
