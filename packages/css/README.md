# @memoized-dom/css

Styles are functions. TypeScript is the language; this package is the
compiler/interpreter that lowers style functions to the cheapest possible
target — usually a static stylesheet.

See `design.md` for the full model. Quick reference:

```ts
import { css, style, vars, keyframes } from '@memoized-dom/css';

// static → hashed class, emitted to the registry
const card = css({ display: 'flex', padding: '16px' });

// dynamic → a function; params are the dynamic surface
const badge = css(($: { size: Length; tone: Color }) => ({
  width: $.size,
  height: $.size,
  background: $.tone,
  borderRadius: '50%',
}));

<div {...badge({ size: '24px', tone: 'tomato' })} />   // → class + (vars, when compiled)

// fragments — the compositional unit, uncompiled until spread into css()
const focusable = style({ focusVisible: { outline: '2px solid currentColor' } });
const sized = style(($: { size: Length }) => ({ width: $.size, height: $.size }));

const avatar = css(($: { size: Length; online: boolean }) => ({
  ...focusable,
  ...sized({ size: $.size }),
  border: $.online ? '2px solid green' : '2px solid transparent',
}));

// contexts are nested objects with a typed keyspace
const item = css(($: { hot: boolean }) => ({
  padding: '8px',
  hover: { background: $.hot ? 'red' : 'pink' },          // pseudo key
  'nth-child(2)': { fontWeight: 'bold' },                  // parameterized
  '.icon': { marginRight: '8px' },                         // selector key
  '&.active': { fontWeight: 'bold' },                      // & self-reference
  media: { minWidth: '40rem', style: { padding: '16px' } },
  supports: { query: { display: 'grid' }, style: { display: 'grid' } },
  container: { minWidth: '30rem', style: { padding: '16px' } },
}));

// responsive: a value is a piecewise function of viewport width
const panel = css({
  padding: { base: '8px', '>=40rem': '16px', '>=64rem': '24px' },
  //   base = default; range keys override at their breakpoint
});

// scoped custom properties — typed VarRefs usable as values
const theme = vars({ accent: '#f60' });
const link = css({ color: theme.accent });   // → color: var(--m…-accent)

const spin = keyframes({ from: { transform: 'rotate(0)' }, to: { transform: 'rotate(360deg)' } });
const spinner = css({ animation: `1s linear infinite ${spin}` });
```

## Getting the CSS

```ts
import { getCssText, mountStyles } from '@memoized-dom/css';

getCssText();    // the collected stylesheet (SSR / extraction)
mountStyles();   // inject/update <style data-memoized-css> (browser, dev)
```

Everything is content-addressed: identical styles dedupe to the same class,
and the stylesheet is deterministic.

## The pipeline

```
style fn ──▶ classify ──▶ normalize ──▶ emit ──▶ registry
  (TS)        (IR)         (lift maps     (.css)   (dedupe,
                          + conds)                 collect)
```

- **`src/grammar.ts`** — the IR: `static | param | cond | map` value nodes,
  blocks, preludes, program manifest (`params`, `variants`). This is the
  "grammar-like" structure — the dynamic surface is explicit in the tree.
- **`src/classify.ts`** — `StyleObject → StyleProgram`. Dispatches keys by
  position (property / pseudo / selector / at-rule) and lifts maps into
  media blocks and conds into variant classes, to fixpoint.
- **`src/emit.ts`** — `StyleProgram → .css` text.
- **`src/registry.ts`** — content-hash dedupe + collection + injection.
- **`src/api.ts`** — `css`, `style`, `vars`, `keyframes`.
- **`src/types.ts`** — the value vocabulary (`Length`, `Color`, …) and the
  `StyleObject` keyspace.

## Interpreted vs compiled

Interpreted mode (today): `css(fn)` calls the function per invocation, so
each distinct argument set specializes into its own class — correct but can
produce more classes than needed when args vary continuously.

Compiled mode (planned, via `@memoized-dom/compiler`): the compiler reads
the function body ahead of time and produces `param`/`cond` IR nodes
directly — `$.x` becomes `var(--x)` bound inline, `$.a ? x : y` becomes a
variant class pair toggled at the call site. The manifest
(`program.params`, `program.variants`) is the hook. Grammar-level tests in
`tests/css.test.ts` exercise those nodes already.
