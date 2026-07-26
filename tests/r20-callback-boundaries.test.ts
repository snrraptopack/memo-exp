/**
 * R20 callback-boundary regressions outside JSX-producing list callbacks.
 *
 * Ordinary collection derivations retain their return semantics, while pure
 * callbacks do not acquire invalidation commits.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@memoized-dom/compiler';

describe('R20 - ordinary callback boundaries', () => {
  it('keeps a non-template map as a pure local derivation', () => {
    const code = compile(`
      function App() {
        let factor = 2;
        const values = [1, 2];
        const mapped = values.map(value => value * factor);
        return <button onClick={() => factor++}>{mapped.join(',')}</button>;
      }
    `);

    expect(code).toContain(
      'mapped = values.map(value => value * factor)',
    );
    expect(code.match(/values\.map\(value => value \* factor\)/g)).toHaveLength(
      2,
    );
    expect(code).not.toContain('commitWrites');
  });
});
