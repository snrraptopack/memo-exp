/**
 * Type-level tests — this file is checked by tsconfig.test.json, not run.
 * Every @ts-expect-error must produce an error; every bare usage must pass.
 */
import type { Color, Length, Percentage } from '../src/index';
import { css, style } from '../src/index';

// --- params use the vocabulary types, literals check against the grammar ---

const badge = css(($: { size: Length; tone: Color }) => ({
  width: $.size,
  height: $.size,
  background: $.tone,
  borderRadius: '50%', // literal stays literal → Percentage
}));

badge({ size: '24px', tone: 'tomato' });
// @ts-expect-error — 'thick' is not a Length
badge({ size: 'thick', tone: 'tomato' });
// @ts-expect-error — 'blue-green' is not a Color
badge({ size: '24px', tone: 'blue-green' });
// @ts-expect-error — missing param
badge({ size: '24px' });

// --- ternary branches keep literal types ---

const btn = css(($: { primary: boolean }) => ({
  color: $.primary ? 'white' : 'black',
}));
btn({ primary: true });
// @ts-expect-error — params required
btn();

// --- static css() checks the grammar too ---

css({ borderRadius: '50%', color: 'red' });
// @ts-expect-error — not a Length
css({ padding: 'thick' });
// @ts-expect-error — not a FlexDirection
css({ flexDirection: 'sideways' });
// @ts-expect-error — not a range key
css({ padding: { '>=40': '8px' } });
// @ts-expect-error — unknown media feature
css({ media: { minWidht: '40rem' } });
// @ts-expect-error — feature value not a Length
css({ media: { minWidth: 'red' } });

// --- params with specific grammars ---

const meter = css(($: { pct: Percentage }) => ({ width: $.pct }));
meter({ pct: '50%' });
// @ts-expect-error — not a Percentage
meter({ pct: '50px' });

// --- fragments compose and check args ---

const sized = style(($: { size: Length }) => ({ width: $.size, height: $.size }));
const avatar = css(($: { size: Length; online: boolean }) => ({
  ...sized({ size: $.size }),
  borderRadius: '50%',
  border: $.online ? '2px solid green' : 'none',
}));
avatar({ size: '40px', online: true });
// @ts-expect-error — fragment arg type
sized({ size: 42 });
// @ts-expect-error — missing param
avatar({ size: '40px' });
