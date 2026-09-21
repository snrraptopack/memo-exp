# @memoized-dom/css — design brainstorm (v2)

Living document. We discuss here before implementing. Sections marked
**[decision]** are open questions; **[proposal]** is a suggested direction.

> **Status:** v2 surface — the `$` proxy param is gone. The dynamic surface
> is the function's own parameter list, destructured like any JS function.
> Everything else (static extraction, var bindings, variant classes,
> contexts, value maps, vars/keyframes) carries over conceptually.

## Vision

Styles are **functions**. TypeScript is the language — no custom syntax, no
new DSL, no magic identifiers. What we own is the *compiler/interpreter*
that evaluates style functions and lowers them to the cheapest possible
target: a static `.css` file, CSS custom properties, variant classes.

The difference from stylex/vanilla-extract: in those, a style is a static
object and dynamism is patched on via vars/conditions as separate concepts.
Here a style is `params => declarations` — the dynamic surface is literally
the function signature, typed and destructured like real code.

Two evaluation modes for the *same* function:

- **Interpreted** (standalone, this package): runtime calls the function,
  classifies the result, caches into a stylesheet. Works anywhere, zero
  build step.
- **Compiled** (via `@memoized-dom/compiler`): the compiler reads the
  function body ahead of time, emits static CSS, and rewrites the
  declaration to `params => { class, style }`. The runtime cost goes to
  zero.

## The core model

```ts
import { css } from '@memoized-dom/css';

// fully static
const base = css({
  display: 'flex',
  padding: '16px',
});

// dynamic — the destructured params are the dynamic surface
const card = css(({ accent, active }: { accent: Color; active: boolean }) => ({
  color: accent,                            // param read → CSS var
  padding: '16px',                          // untouched → static rule
  borderColor: active ? 'blue' : 'gray',    // ternary on param → binding
  hover: { opacity: 0.8 },                  // context → nested rule
}));

// usage — the call binds the dynamic inputs, type-checked
<div {...card({ accent: theme.accent, active: isActive() })} />
```

There is no `$`, no proxy, no magic name. `accent` and `active` are ordinary
parameter names — rename them freely, destructure them however JS allows.

Semantics — the lowering table:

| What the body does | Classification | Lowers to |
|---|---|---|
| literal / closed-over constant | static | rule in the stylesheet |
| any expression reading a param | dynamic | `var(--x)` + the JS expression preserved as the binding |
| condition switching *structure* (`...(cond ? a : b)`) | conditional | variant classes, toggled at runtime |
| dynamic selectors / dynamic rule structure | unsupported | explicit `CssAnalysisError` |

Two rules carry over unchanged:

- **A dynamic computation is not dynamic CSS generation.**
  `width: `${Math.max(0, size)}px`` doesn't need the compiler to understand
  `Math.max` — the whole expression stays JavaScript and its *result* is
  bound: `width: var(--x)`; `--x` updated at the call site.
- **A ternary changing one value is a binding, not a class pair.**
  `color: active ? 'royalblue' : 'gray'` → `color: var(--x)` where the
  binding is the JS ternary. Variant classes are for conditions that switch
  groups of declarations — **values bind, structure toggles.**

## Why destructured params (and not `$`)

The old surface needed a proxy name (`$`) plus a rewrite layer
(`$.x → args.x`) plus collision handling for the generated arg name — and
every semantic bug lived in that rewrite. Destructured params delete the
whole layer:

**The emitted function keeps the authored signature — verbatim.**

```ts
const card = css(({ size, active }: { size: Length; active: boolean }) => ({
  width: size,
  color: active ? 'royalblue' : 'gray',
}));
```

```ts
// compiled output — the params are yours, untouched:
const card = ({ size, active }) => ({
  class: 'm1cb' + (active ? ' m1cbv0t' : ' m1cbv0f'),
  style: {
    '--m1cb-b0': size,
    '--m1cb-b1': active ? 'royalblue' : 'gray',
  },
});
```

`size` binds to `size`. No substitution, no generated names, nothing to
shadow. Binding expressions keep their JavaScript character by
construction.

**TypeScript enforces the surface for free.** `({size}) =>` without an
annotation is `Binding element 'size' implicitly has an 'any' type` under
`noImplicitAny` — the compiler itself demands the declaration. The `$`
version needed a custom "untyped param" error; now the language does it.

**Everything destructuring knows, params know:**

```ts
css(({ size = '24px' }: { size?: Length }) => ...)   // defaults
css(({ theme: { accent } }: Props) => ...)           // nesting
css(({ size: s }: { size: Length }) => ...)          // renames
css(({ size, ...rest }: Props) => ...)               // rest
css((size: Length, tone: Color) => ...)              // multiple positional params
css((p: { size: Length }) => ({ width: p.size }))    // named-param idiom — p is "your $"
```

**[decision]** Canonical form is destructured object params. The named-param
idiom `(p) => p.size` works identically (member reads are just another
expression shape) — document destructure-first, support both.

**[proposal]** Param reads are the set of identifiers bound by the param
pattern. Analysis is scope-aware: an identifier counts as a param read
unless a nested function parameter or local declaration shadows it —
ordinary lexical semantics, nothing special.

## Authoring surface (all TS, all typed)

```ts
css(object)                      // static style → { class }
css((params) => object)          // dynamic style → (params) => { class, style? }
vars({ accent: '#f00' })         // scoped custom properties → class + typed VarRefs
keyframes({ from, to })          // named animation → hashed name
// + the type vocabulary: Length, Percentage, Color, Angle, Time, VarRef<T>, …
```

**Fragments are plain values — no marker API.** A style object literal is a
fragment; a plain function returning one is a parameterized fragment:

```ts
const interactive = {
  cursor: 'pointer',
  transition: 'transform 0.15s ease',
};

const sized = ({ size }: { size: Length }) => ({
  width: size,
  height: size,
});

const avatar = css(({ size, online }: { size: Length; online: boolean }) => ({
  ...interactive,                          // object fragment → inlined
  ...sized({ size }),                      // fn fragment → inlined with args
  borderRadius: '50%',
  border: `2px solid ${online ? 'green' : 'transparent'}`,
}));
```

Composition is ordinary JavaScript: spread, calls, ternaries. The compiler
inlines resolvable fragments into one program; in interpreted mode the same
spread evaluates naturally — same source, same meaning both ways.

Design tokens aren't a special system — they're TS values closed over by
style functions. `const theme = { accent: '#f00' }` referenced inside
`css()` binds like any expression. For runtime themes: `vars()` — tokens as
custom properties, still typed.

## Examples — the model end to end

### Dynamic values: param expressions → bindings

```ts
const badge = css(({ size, tone }: { size: Length; tone: Color }) => ({
  width: size,
  height: size,
  background: tone,
  borderRadius: '50%',
}));
```

One compiled template — fixed CSS plus bindings:

```css
.m1a2b { border-radius: 50%;
         width: var(--m1a2b-b0); height: var(--m1a2b-b0);
         background: var(--m1a2b-b1); }
```

```tsx
<div {...badge({ size: '24px', tone: 'tomato' })} />
// → class="m1a2b" style="--m1a2b-b0: 24px; --m1a2b-b1: tomato"
```

Two reads of `size` share one binding — dedupe is by expression. And a
binding is the *whole expression*, not a name:

```ts
const meter = css(({ pct }: { pct: Percentage }) => ({
  width: pct,                                                    // --b0: pct
  backgroundImage: `linear-gradient(90deg, green ${pct}, transparent ${pct})`,
  // → backgroundImage: var(--b1); --b1: the whole template string
}));
```

`pct ?? '8px'` binds `pct ?? '8px'` — JS `??` stays in the binding (CSS var
fallback has different semantics). `` `${pct}%` `` binds the whole template —
it can never become `var(--pct)%`.

### Conditions that switch structure → variant classes

```ts
const card = css(({ elevated }: { elevated: boolean }) => ({
  padding: '8px',
  ...(elevated
    ? { boxShadow: '0 4px 12px rgb(0 0 0/.2)', borderColor: 'transparent' }
    : { borderColor: '#ddd' }),
}));
```

```css
.m { padding: 8px; }
.mv0t { box-shadow: 0 4px 12px rgb(0 0 0/.2); border-color: transparent; }
.mv0f { border-color: #ddd; }
```

```tsx
<div class={elevated ? 'm mv0t' : 'm mv0f'} />
```

JavaScript order is preserved exactly — declarations after the conditional
spread apply in *both* branches (the tail is merged into each branch).
Inactive branches never evaluate their bindings:
`...(show ? { color: theme.color } : {})` with `show: false` binds
`show ? theme.color : undefined` — the guard travels with the binding.

### Typed params — the vocabulary

Param types are a **CSS value vocabulary**, not `string`:

```ts
type Length     = `${number}px` | `${number}rem` | `${number}em` | `calc(${string})` | ...;
type Percentage = `${number}%`;
type Color      = Hex | `rgb(${string})` | `oklch(${string})` | NamedColor | ...;
type Angle      = `${number}deg` | `${number}rad` | `${number}turn`;
type Time       = `${number}ms` | `${number}s`;
```

```ts
meter({ pct: '50%' });   // ✓
meter({ pct: '50px' });  // ✗ not a Percentage
meter({ pct: 50 });      // ✗ not a string at all
meter({ });              // ✗ missing pct — the destructure checks call sites too
```

### Contexts: nested objects, typed keyspace

Contextual styling is nesting — a key opens another style object. Three key
families, distinguished by shape:

```ts
const item = css(({ hot }: { hot: boolean }) => ({
  padding: '8px',

  // 1. pseudo-classes/elements — bare keys from a typed union
  hover: { background: hot ? 'red' : 'pink' },
  focusVisible: { outline: '2px solid currentColor' },
  'nth-child(2)': { fontWeight: 'bold' },
  'not(.disabled)': { opacity: 1 },

  // 2. selectors — string keys starting with a selector char
  '.icon': { marginRight: '8px' },
  '> *': { flexShrink: 0 },

  // 3. at-rules — reserved keys, features object + `style` body
  media: { minWidth: '40rem', style: { padding: '16px' } },
  supports: { query: { display: 'grid' }, style: { display: 'grid' } },
}));
```

- **Pseudo keys**: union of pseudo-class names plus template-literal
  patterns — `` `nth-child(${AnPlusB})` ``, `` `not(${string})` ``,
  `` `has(${string})` ``. `hovr:` doesn't compile.
- **Selector keys**: `` `${SelectorStart}${string}` `` — `.`, `#`, `>`, `+`,
  `~`, `[`, `&`, `*`.
- **At-rule keys**: `media`/`supports`/`container`/`layer`. Feature names
  and values typecheck — `minWidht` fails, `minWidth: 'red'` fails.
  Arguments must be static — dynamic at-rule args error.

Everything inside a context is the same language: param reads, ternaries,
fragments, deeper contexts.

### Responsive composition: value maps

Any value position accepts `V` or a value map — a piecewise function of the
viewport-width axis:

```ts
const card = css({
  padding: { base: '8px', '>=40rem': '16px', '>=64rem': '24px' },
  gridTemplateColumns: { base: '1fr', '>=40rem': '1fr 1fr' },
});
```

- `base` applies always; each range key overrides it upward.
- Keys are typed — `` `>=${Length}` ``: `'>=40'` fails, `'>=40rem'` works.
- Width only — height/container ranges use the block form (`media`,
  `container`), one mechanism per semantic.
- Maps compose with contexts, ternaries, and params (`{ base: on ? '8px' : '0' }`
  → per-range bindings).

```css
.m { padding: 8px; }
@media (min-width: 40rem) { .m { padding: 16px; } }
@media (min-width: 64rem) { .m { padding: 24px; } }
```

### vars and keyframes

```ts
const theme = vars({ accent: '#7c3aed', ink: '#1e1b29' });
// → .mHASH { --mHASH-accent: #7c3aed; --mHASH-ink: #1e1b29; }
// theme.accent is a typed VarRef → 'var(--mHASH-accent)' when applied

const rise = keyframes({
  from: { opacity: '0', transform: 'translateY(6px)' },
  to: { opacity: '1', transform: 'translateY(0)' },
});

const badge = css(({ on }: { on: boolean }) => ({
  animation: `${rise} 300ms ease`,   // whole template → one binding
  background: on ? theme.accent : '#e8e6ee',
}));
```

### What the types catch

```ts
css({ padding: 'thick' });              // ✗ not a Length
css({ hovr: {} });                      // ✗ not a pseudo, property, or selector
css({ media: { minWidht: '40rem' } });  // ✗ unknown media feature
css({ padding: { '>=40': '8px' } });    // ✗ not a range key
meter({ pct: '50px' });                 // ✗ not a Percentage
avatar({ size: '40px' });               // ✗ missing `online`
sized({ size: 42 });                    // ✗ fragment arg type mismatch
theme.count + 'px';                     // ✗ VarRef isn't a number
```

## Pipeline

```
style fn ──▶ analyze ──▶ classify ──▶ emit
             (param reads   (IR: static/    (.css text +
              → bindings,    bind/cond/      hashed class +
              conditional    map/when)       manifest)
              spreads →
              variants)
```

- **analyze**: walks the function AST. Param reads → expression bindings
  (JS preserved verbatim); conditional spreads → structural variants
  (tail-merged per branch, guard-aware); literals → static; fragment
  spreads/calls → inlined via lexical scope. Dynamic selectors/structure →
  `CssAnalysisError`.
- **classify**: `StyleObject → StyleProgram` — keyspace dispatch
  (property / pseudo / selector / at-rule / `$$when`), maps lift to media
  blocks, to fixpoint.
- **emit**: deterministic content-hash class names (same input → same name
  → dedupe across modules), stylesheet text, manifest of bindings +
  variant tests for the compiler.

Compiled lowering emits the *authored param pattern* on the generated
function — `({size, active}) => ({class, style})` — so binding and test
expressions run verbatim with zero substitution.

Class granularity **[decision]**: per-rule base class + variant classes per
condition (hybrid) — toggling never re-sends the base.

## Interpreted vs compiled

| | Interpreted | Compiled |
|---|---|---|
| `css(obj)` | `{class}` | `{class}` + extracted rule |
| `css(fn)` | calls fn per invocation, specializes per distinct args | `(params) => {class, style}` — one bounded template |
| stylesheet | grows with distinct arg combos | fixed — bindings carry the variation |
| build step | none | `@memoized-dom/compiler` |

Same source, same authored semantics — specialization is the
zero-build-step fallback, never the model.

## Integration with @memoized-dom/compiler

The package exposes `analyzeStyleFn(ast, {resolveIdentifier}) →
{program, bindings, variants, params}` — analysis without emitting. The
m-d compiler then:

1. static part → stylesheet artifact (`.memo-style.css` via vite)
2. param-reading expressions → `var(--x)` bindings on `style`, JS verbatim
3. structural conditions → `class` toggles — same machinery it already
   uses for conditional DOM
4. `{class, style}` flows through the normal spread/prop pipeline —
   reactive values in bindings update through existing machinery

Fragments resolve through lexical scope — same-module always; cross-module
when modules compile together (the linker shares module ASTs).

## Open questions

1. ~~Param surface~~ → destructured params; named-param `(p)` idiom also
   supported. `$` deleted.
2. ~~Composition~~ → fragments are plain objects/functions; `style()`
   deleted.
3. Call shape → `{ class, style? }` spreadable; `class={ref}` applies the
   class only. Pure-static calls return `{class}`.
4. Should `css(fn)` allow *multiple positional* params
   (`css((size, tone) => ...)`) or object-params-only as the contract?
   (Lean: allow both — the pattern is just a signature.)
5. Specificity when multiple variants are active: source order, `@layer`,
   or explicit precedence?
6. Theming: is `vars()` enough, or a first-class `theme()` later?
7. Media query composition: features-object enough (implicit `and`), or
   `or`/`not` forms? Same for value maps.
8. Interpreted mode's output target: `<style>` tag per module? single
   stylesheet? Constructable stylesheets?
9. Value-map axis switching → resolved: maps are viewport-width only.
