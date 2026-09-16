# @memoized-dom/css — design brainstorm

Living document. We discuss here before implementing. Sections marked
**[decision]** are open questions; **[proposal]** is a suggested direction.

> **Status:** v1 implemented — `css`, `style`, `vars`, `keyframes`, value
> maps, nested contexts, interpreted-mode specialization, and the
> param/cond IR with emission. See README.md.

## Vision

Styles are **functions**. TypeScript is the language — no custom syntax, no
new DSL. What we own is the *compiler/interpreter* that evaluates style
functions and lowers them to the cheapest possible target: a static `.css`
file, CSS custom properties, variant classes, or (rarely) runtime injection.

The difference from stylex/vanilla-extract: in those, a style is a static
object and dynamism is patched on via vars/conditions as separate concepts.
Here a style is `params => declarations` — the dynamic surface is literally
the function signature. The compiler interprets the function body
symbolically: every read of a param marks a typed dependency, every ternary
on a param marks a condition, everything else is static.

Two evaluation modes for the *same* function:

- **Interpreted** (standalone, this package): runtime evaluates the function,
  classifies the result, caches the static part into a stylesheet. Works
  anywhere, zero build step.
- **Compiled** (via `@memoized-dom/compiler` later): the compiler reads the
  function body ahead of time, emits static CSS, and rewrites call sites to
  class toggles + var bindings. The runtime cost goes to zero.

## The core model

```ts
import { css } from '@memoized-dom/css';

// fully static — a function of zero params
const base = css({
  display: 'flex',
  padding: '16px',
});

// dynamic — params are the dynamic surface
const card = css(($: { accent: string; active: boolean }) => ({
  color: $.accent,                          // param read → CSS var
  padding: '16px',                          // untouched → static rule
  borderColor: $.active ? 'blue' : 'gray',  // ternary on param → variants
}));

// usage — the call binds the dynamic inputs
<div {...card({ accent: theme.accent, active: isActive() })} />
```

Semantics:

| What the body does | Classification | Lowers to |
|---|---|---|
| literal / closed-over constant | static | rule in `.css` file |
| `$.x` used as a value | dynamic | `--card-x` custom property, set inline |
| `$.x ? a : b` on a finite param | conditional | variant classes, toggled at runtime |
| arbitrary computation on params | opaque | runtime injection (warnable) |

The function body is a *template*: interpreted mode runs it per call and
diffs; compiled mode symbolic-executes it once and emits the bindings.

**[proposal]** `$` is a plain object of the declared type — no proxies, no
magic. `css(($: P) => StyleObject)` and `card(params: P): { class: string;
style?: ... }`. The type parameter flows straight through, so params are
type-checked end to end.

## Authoring surface (all TS, all typed)

```ts
css(object)                    // static style → class name
css(($) => object)             // dynamic style → (params) => { class, style? }
style(object | ($) => object)  // uncompiled fragment — the compositional unit
keyframes({ from, to })        // named animation → hashed name
vars({ accent: '#f00' })       // scoped custom property set → class + VarRefs
// + the type vocabulary: Length, Percentage, Color, Angle, Time, VarRef<T>, …
```

Design tokens aren't a special system — they're just TS values closed over
by style functions. `const theme = { accent: '#f00' }` used inside `css()`
is inlined into static CSS at compile time. If we later want runtime
themes, that's what `vars()` is for: tokens-as-vars, still typed.

**[decision]** Do param reads *only* work through `$`, or can the function
also close over reactive values? Lean: params only. Closures over reactive
state should go through the component's own reactivity and be passed in as
params — keeps the style function pure and trivially analyzable.

## Examples — the model end to end

### Dynamic values: params → custom properties

```ts
const badge = css(($: { size: Length; tone: Color }) => ({
  width: $.size,
  height: $.size,
  background: $.tone,
  borderRadius: '50%',
}));
```

The lowering depends on what the **call site** binds:

```tsx
// literal args → full specialization, no vars at all
<div {...badge({ size: '24px', tone: 'tomato' })} />
```

```css
.m1a2b { width: 24px; height: 24px; background: tomato; border-radius: 50%; }
```

```tsx
<div class="m1a2b" />
```

```tsx
// dynamic args → vars only where needed
<div {...badge({ size: props.size, tone: 'tomato' })} />
```

```css
.m9z8y { background: tomato; border-radius: 50%;
         width: var(--m-s); height: var(--m-s); }
```

```tsx
<div class="m9z8y" style="--m-s: 24px" />
```

So a param isn't intrinsically "a var" — it's a hole the call site fills.
Literal → inlined into the stylesheet (and the class hash reflects it, so
each specialization is its own deduped class). Dynamic → var. Two reads of
`$.size` share one var — the classifier dedupes param reads.

### Conditions: ternaries on params → variant classes

```ts
const button = css(($: { variant: 'primary' | 'ghost'; disabled: boolean }) => ({
  padding: '8px 16px',
  borderRadius: '6px',
  background: $.variant === 'primary' ? 'royalblue' : 'transparent',
  color: $.disabled ? '#888' : 'inherit',
  cursor: $.disabled ? 'not-allowed' : 'pointer',
}));
```

```css
.m1a2b { padding: 8px 16px; border-radius: 6px; }
.m3c4d { background: royalblue; }
.m5e6f { background: transparent; }
.m7g8h { color: #888; cursor: not-allowed; }
.m9i0j { color: inherit; cursor: pointer; }
```

```tsx
<button {...button({ variant, disabled })} />
// → class="m1a2b m3c4d m9i0j"   (compiler emits the ternary on class)
```

Same condition used twice (`disabled`) merges into one variant pair —
classification is by *condition*, not by declaration.

### Fallbacks and interpolation on params

```ts
const box = css(($: { pad?: Length; grow: number }) => ({
  padding: $.pad ?? '8px',        // ??  → var(--m-p, 8px)
  flexGrow: $.grow,               // plain read
}));
```

Params are typed with a **CSS value vocabulary**, not `string`. The package
exports the spec's grammar as types:

```ts
type Length     = `${number}px` | `${number}rem` | `${number}em` | `calc(${string})` | ...;
type Percentage = `${number}%`;
type Color      = Hex | `rgb(${string})` | `oklch(${string})` | NamedColor | ...;
type Angle      = `${number}deg` | `${number}rad` | `${number}turn`;
type Time       = `${number}ms` | `${number}s`;
// ...the property map is built from these: padding: Length, color: Color, ...
```

So param types are real and checked — `pct: Percentage`, not a comment:

```ts
const meter = css(($: { pct: Percentage }) => ({
  width: $.pct,                        // → width: var(--m-pct)
  backgroundImage: `linear-gradient(90deg, green ${$.pct}, transparent ${$.pct})`,
  // → linear-gradient(90deg, green var(--m-pct), transparent var(--m-pct))
}));

meter({ pct: '50%' });   // ✓
meter({ pct: '50px' });  // ✗ not a Percentage
meter({ pct: 50 });      // ✗ not a string at all
```

`${$.x}` anywhere in a string becomes `var(--m-x)` at that position — exactly
how CSS custom properties already behave, nothing to invent. If the property
needs math, the author writes `calc()` themselves:
`width: calc(${$.pct} / 2)` → `width: calc(var(--m-pct) / 2)`.

This is where "css as a programming language" pays off — `??`, ternaries,
`===`, template strings all have defined lowerings, so idiomatic TS *is* the
style language.

### Fragments: the compositional unit

`css()` is a compile boundary — it returns a class/function, not an object,
so you can't spread its result. Composition happens one level down, on
**fragments**:

```ts
import { style, css } from '@memoized-dom/css';

const focusable = style({
  focusVisible: { outline: '2px solid currentColor', outlineOffset: '2px' },
});

// fragment functions take explicit args — a real call, param names are local
const sized = style(($: { size: Length }) => ({
  width: $.size,
  height: $.size,
}));

const avatar = css(($: { size: Length; online: boolean }) => ({
  ...focusable,
  ...sized({ size: $.size }),                    // explicit param wiring
  borderRadius: '50%',
  border: $.online ? '2px solid green' : '2px solid transparent',
}));

avatar({ size: '40px', online: true });
```

`style()` never emits a class by itself — it's an uncompiled fragment.
Because fragment calls take real args, the wiring is explicit and free:

```ts
...sized({ size: '32px' })        // literal → fragment specializes to static
...sized({ size: $.avatarSize })  // renames flow naturally
...sized({ size: `calc(${$.size} * 2)` })  // computed args work too
```

To the classifier, `sized({size: $.size})` is just `size` marked as a
dependency — same as if you'd written `width: $.size` inline. Fragments are
how you build a local design vocabulary without a token system.

### Typed vars and themes

```ts
const theme = vars({ accent: '#f60', fg: '#111' });   // → class declaring --accent, --fg

const link = css({
  color: theme.accent,              // var ref — typed, and compiles to var(--accent)
  hover: { color: theme.fg },
});
```

`theme.accent` isn't a string — it's a typed `VarRef`. Passing
`theme.accent` where a color goes typechecks; passing `theme.count` (a
number var) doesn't.

### Contexts: nested objects, typed keyspace

Contextual styling is just **nesting** — a key opens another style object.
What makes it a language instead of a bag of strings is that the *keyspace
is typed*. Three key families, distinguished by shape:

```ts
const item = css(($: { hot: boolean }) => ({
  padding: '8px',

  // 1. pseudo-classes/elements — bare keys from a typed union
  hover: { background: $.hot ? 'red' : 'pink' },   // variant scoped to :hover
  focusVisible: { outline: '2px solid currentColor' },
  before: { content: '""' },

  // parameterized pseudos via template-literal keys
  'nth-child(2)': { fontWeight: 'bold' },
  'not(.disabled)': { opacity: 1 },

  // 2. selectors — string keys, must start with a selector char
  '.icon': { marginRight: '8px' },
  '> *': { flexShrink: 0 },

  // 3. at-rules — reserved keys, value = features + `style` body
  media: { minWidth: '40rem', orientation: 'landscape', style: { padding: '16px' } },
  supports: { query: { display: 'grid' }, style: { display: 'grid' } },
  container: { minWidth: '30rem', style: { padding: '16px' } },
}));

// per-property responsiveness doesn't need a block at all — see below
const card2 = css({
  padding: { base: '8px', '>=40rem': '16px' },
});
```

How the types work:

- **Pseudo keys**: union of all pseudo-class names (`hover`, `focusVisible`,
  `nthChild`? — or kebab `'nth-child'` form) plus template-literal patterns
  for the parameterized ones: `` `nth-child(${number})` ``,
  `` `nth-child(${AnPlusB})` ``, `` `not(${string})` ``, `` `has(${string})` ``.
  `hovr:` doesn't compile — it's not in the union. No method-call syntax,
  no colons, pseudos read as part of the object grammar.
- **Selector keys**: `` `${SelectorStart}${string}` `` where SelectorStart is
  `.`, `#`, `>`, `+`, `~`, `[`, `&`, `*` — loose, but it can't collide with
  property or pseudo names, and nested value is another `StyleObject`.
- **At-rule keys**: `media`/`supports`/`container`/`layer` are reserved.
  `media`'s value is typed *media features* (`minWidth: Length`,
  `orientation: 'landscape' | 'portrait'`, `prefersColorScheme: 'dark'`, …)
  plus a reserved `style` key holding the nested `StyleObject`. Feature
  names and values typecheck — `minWidht` fails, `minWidth: 'red'` fails.

Everything inside a context is the same language: param reads, ternaries,
fragments, deeper contexts (`media: { minWidth: '40rem', style: { hover: {
... } } }` = hover-on-desktop). Nesting depth is visible in the source.

### Responsive composition: values vary, not blocks

Media queries think in blocks — "when viewport satisfies Q, apply these N
declarations." But responsive design is usually *per-property*: padding
grows, columns split, fonts scale. Restructuring into blocks to change one
property is the mismatch.

So in this language, **any value position accepts either `V` or a value
map** — a piecewise function of an axis:

```ts
const card = css(($) => ({
  // mobile-first ranges — reads top to bottom, each key overrides base
  padding: { base: '8px', '>=40rem': '16px', '>=64rem': '24px' },
  gridTemplateColumns: { base: '1fr', '>=40rem': '1fr 1fr' },
}));
```

Maps are for **viewport-width ranges only**. That restriction is deliberate:
height and container ranges are rare, and letting the same syntax range over
multiple axes re-introduces the overlap problem we just removed. Non-width
ranges use the block form (`media: { minHeight: … }`, `container: { … }`) —
one mechanism per semantic.

| axis | key grammar | lowers to |
|---|---|---|
| viewport width | `'base'`, `'>=${Length}'`, `'<${Length}'`, `'${Length}..${Length}'`, named breakpoints | `@media (min-width …)` |

Details:

- **`base` is the default.** It applies always; each range key overrides it
  at its breakpoint. `{ base: '8px', '>=40rem': '16px' }` means "8px, and
  16px from 40rem up" — not "8px as a fallback." A map without `base`
  means the property is unset below the first range (cascade decides).
- **Keys are typed.** `` `>=${Length}` `` is a template-literal type —
  `'>=40'` fails, `'>=40rem'` compiles. All keys in one map are ranges on
  the width axis.
- **Named breakpoints** merge into the key union when configured —
  `{ base: '8px', md: '16px', '>=lg': '24px' }`.

Light/dark, motion preference, orientation — those aren't *ranges*, they're
conditions, and they already have expressions in the language:

```ts
{
  // standard CSS function, typed in the Color grammar
  color: 'light-dark(#111, #eee)',        // or a lightDark() helper → same

  // or the general conditional machinery
  media: { prefersColorScheme: 'dark', style: { color: '#eee' } },
}
```

So responsive maps stay focused on one job: "this value changes with
size." Everything else goes through the conditional/block forms — one
mechanism per semantic, no overlap.

- **Emission is standard CSS.** Ranges sort and emit as cascading
  min-width blocks:

  ```css
  .m { padding: 8px; grid-template-columns: 1fr; }
  @media (min-width: 40rem) { .m { padding: 16px; grid-template-columns: 1fr 1fr } }
  @media (min-width: 64rem) { .m { padding: 24px } }
  ```

- **Maps compose with everything.** Inside contexts (`hover: { padding:
  { base: '8px', '>=40rem': '16px' } }`), with ternaries in a slot
  (`{ base: $.on ? '8px' : '0' }` → per-range variants), and as params:
  `$: { gap: Length | Map<Length> }` — a responsive dynamic value lowers
  to one var per range slot (`--m-gap-0`, `--m-gap-1`, …) or specializes
  fully if the call site passes a literal map.

The block form stays — it's the right tool for *multi-declaration*
structural changes and arbitrary queries (`media`, `supports`, `container`,
`layer`). The claim: value maps cover ~90% of responsive authoring; blocks
cover the rest. Both compile to the same CSS, so there's no runtime
distinction — only an authoring distinction.

### Keyframes

```ts
const spin = keyframes({
  from: { transform: 'rotate(0)' },
  to: { transform: 'rotate(360deg)' },
});

const spinner = css({ animation: `1s linear infinite ${spin}` });
// spin is a typed AnimationName → interpolation produces the hashed name
```

### What the types catch

```ts
css({ padding: 'thick' });              // ✗ not a Length
css({ flexDirection: 'sideways' });     // ✗ not a FlexDirection
css({ hovr: {} });                      // ✗ not a pseudo, property, or selector
css({ 'nth-child(two)': {} });          // ✗ doesn't match `nth-child(${AnPlusB})`
css({ media: { minWidht: '40rem' } });  // ✗ unknown media feature
css({ media: { minWidth: 'red' } });    // ✗ not a Length
css({ padding: { '>=40': '8px' } });    // ✗ not a range key (`>=${Length}`)
css({ padding: { dark: '8px' } });      // ✗ 'dark' isn't a range — wrong tool
meter({ pct: '50px' });                 // ✗ not a Percentage
button({ variant: 'primry' });          // ✗ param type mismatch
button();                               // ✗ params required
avatar({ size: '40px' });               // ✗ missing `online`
sized({ size: 42 });                    // ✗ fragment arg type mismatch
theme.count + 'px';                     // ✗ VarRef isn't a number
```

## Compiler / interpreter pipeline (this package)

```
style fn ──▶ classify ──▶ normalize ──▶ emit
             (static /    (flatten       (.css text +
              cond /       nesting,       class map +
              dynamic /    dedupe)        manifest)
              opaque)
```

- **classify**: symbolic evaluation of the fn body. Params → holes,
  ternaries on params → conditions, literals → static.
- **normalize**: expand shorthand? split nested selectors/conditions, order
  rules deterministically.
- **emit**: deterministic hashed class names (same input → same name →
  dedupe across modules for free), stylesheet text, manifest.

We do write our own CSS *emitter* (decls → text). Whether we need a full CSS
*parser* is **[decision]** — probably not for v1, since input is objects.
A parser only becomes necessary if we later add a template-literal surface
or want to ingest real .css files.

## Class granularity **[decision]**

- **Per-rule**: `css({...})` → one class with N declarations. Readable DOM,
  easy overrides, bigger stylesheet.
- **Atomic**: each declaration → its own class. Tiny at scale, class soup.
- **Hybrid**: base style per-rule, each conditional variant gets its own
  class (toggling never re-sends the base).

Lean: hybrid. `card` → `.m1a2b` for the base; `active` → `.m3c4d`/`.m5e6f`
toggled.

## Integration with @memoized-dom/compiler (later)

The package exposes `analyze(fn | callExpr) → StyleProgram` — classify
without emitting. The m-d compiler then:

1. static part → stylesheet artifact
2. `$.active ? a : b` → it already compiles ternaries for DOM; now the same
   machinery emits `class={cond ? '.v-a' : '.v-b'}`
3. `$.accent` → bound `style="--card-accent: <expr>"` wired to the signal
4. manifest keeps SSR/hydration class names identical

Because the compiler sees the function body *and* the call site, it can do
the whole lowering without the params ever materializing as an object at
runtime.

## Open questions

1. ~~Call shape~~ → **[proposal]** style fns return a spreadable
   `{ class, style? }` (or a `StyleRef` the JSX layer understands). Pure-static
   calls can return a bare class string. Objections?
2. ~~Composition~~ → fragments via `style()`; param inheritance via
   `frag($)`. Needs a rule: can a css() body spread *another css()* result?
   (Lean: no — compile boundaries don't nest.)
3. Specificity when multiple variants are active: source order, `@layer`, or
   explicit precedence?
4. ~~calc interpolation~~ → dropped. Params carry full typed values;
   `${$.x}` is textual `var(--x)` substitution; authors write `calc()`
   themselves when they want math.
5. Theming: is `vars()` enough, or a first-class `theme()` later?
6. Interpreted mode's output target: `<style>` tag per module? single
   stylesheet? Constructable stylesheets?
7. What TS subset must the compiled-mode analyzer handle? (Proposed: object
   literals, fragment spreads + calls, ternaries, `??`, `===`/`!==`,
   template strings, param member access. Anything else → opaque tier with
   a warn.)
8. Media query composition: is the features-object enough (implicit `and`),
   or do we need `or`/`not` — e.g. `media: { or: [{...}, {...}] }`? Same
   question for value maps — compound conditions currently force the block
   form.
11. ~~Value-map axis switching~~ → resolved: maps are viewport-width only.
    Height/container ranges use the block form.
9. Pseudo key form: bare union keys (`hover`, `focusVisible`) vs. kebab
   (`'focus-visible'`)? camelCase reads more like TS; kebab reads like CSS.
10. Call-site specialization granularity: hash includes specialized args, so
    `badge({size:'24px'})` and `badge({size:'32px'})` are different classes.
    Dedupe handles it, but is per-literal-arg specialization ever a footgun
    (class explosion from loops)?

## Non-goals

- No custom syntax/language — TypeScript only.
- No PostCSS compat, no ingesting arbitrary .css.
- Runtime theming beyond custom properties (for now).
