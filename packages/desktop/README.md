# Memoized DOM desktop

This package adapts the framework's compiled components and shared reactive core
to a retained Rust scene rendered by GPUI. Applications use TSX, ordinary CSS,
and the normal `mount` API. Rust owns tag semantics, text preparation, native
controls, layout, and painting.

This README describes the **currently implemented desktop contract**. A tag,
property, or method appearing in browser JSX types does not establish desktop
support. Use the tables below when deciding what an application can depend on.
The [architecture research](../../docs/compiled-native-architecture.md) explains
the design and GPUIX comparison; this file is the package capability reference.

## Run an example

From the repository root:

```sh
bun run desktop:dev
bun run desktop:todo
bun run desktop:reactivity
```

These commands build the shared runtime, compiler, desktop adapter, and native
window executable. The examples exercise controls and component/list ownership,
todo interactions and styling, and cross-module state respectively.

An authored entry still looks like this:

```ts
import { mount } from '@memoized-dom/runtime';
import { App } from './App';

mount('root', App);
```

The desktop build redirects that entry import to the desktop mount adapter.
`'root'` names an application root; it is not an HTML element ID to look up.
Generated imports from `@memoized-dom/runtime/core` use the shared semantic core.

## What an element is

There are three distinct shapes:

| Shape | Purpose | Where it exists |
| --- | --- | --- |
| Scene node | Immutable authored structure, attributes, and declarations | Compiler output and Rust's installed template |
| Ref handle | Small, live capability object for an accepted element | JavaScript component ref |
| Event target snapshot | Values relevant to a particular native event | `event.target`, `event.currentTarget`, and the event path |

None of these creates a browser document. They must not be treated as interchangeable
objects or assumed to implement `HTMLElement`.

### Scene node and template

The transport shape comes from [scene/schema.ts](src/scene/schema.ts):

```ts
type SceneNode =
  | {
      readonly kind: 'element';
      readonly tag: string;
      readonly parent: number | null;
      readonly text: '';
      readonly attributes?: Readonly<Record<string, string>>;
      readonly style?: readonly {
        readonly property: string;
        readonly value: string;
      }[];
    }
  | {
      readonly kind: 'text';
      readonly parent: number | null;
      readonly text: string;
    }
  | {
      readonly kind: 'region';
      readonly parent: number | null;
      readonly multiple?: boolean;
    };
```

`parent` is an index into the template's `nodes` array; `null` denotes a root.
An element's children follow that topology rather than a `children` property.
Text is represented by separate text nodes, not an element's `textContent`.
Regions are compiler attachment points for components, conditional branches, and
keyed rows. They add no authored tag or layout wrapper. `multiple` allows a list
region to contain multiple child instances.

A `SceneTemplate` has these properties:

| Property | Shape and meaning |
| --- | --- |
| `id` | String identifying the immutable template |
| `nodes` | Ordered array of scene nodes |
| `slots` | Array of `{ node, type: 'text' \| 'value' }` describing mutable destinations |
| `events` | Array of `{ node, type }` identifying authored event sites |
| `stylesheets` | Optional parsed CSS rules and declarations |
| `stylesheet` | Optional shared stylesheet source identity |

Templates are shared by instances. JavaScript keeps bindings, callbacks,
dependencies, and ownership; Rust retains the accepted scene and its presentation
data. Updates carry slot writes and structural operations instead of replacing
the template.

Live instance identity is `{ id: number, generation: number }`, called a
`SceneHandle`. Identify an element with **both the instance handle and its template
node index**. A node index alone is not globally unique, and a retired generation
must not receive events. Template IDs, application root names, instance handles,
and authored `id` attributes identify different things.

### Ref handle properties

The internal `SceneElement` contract is defined in
[runtime/application.ts](src/runtime/application.ts) and created in
[runtime/lifecycle.ts](src/runtime/lifecycle.ts):

| Property or method | Current behavior |
| --- | --- |
| `handle` | Owning instance's `{ id, generation }` |
| `node` | Element index within its template |
| `tagName` | Uppercase authored tag, such as `'INPUT'` or `'P'` |
| `isConnected` | Live getter; true while its owner is mounted and not disposed |
| `ownerDocument` | Always `null`; used by shared ref lifecycle checks |
| `id` | Static authored `id`, or `''` |
| `value` | Latest acknowledged value slot, otherwise static `value`, otherwise `''` |
| `getAttribute(name)` | Static attribute value, or `null`; use normalized names such as `'class'` |

The object is frozen, and its properties are read-only. `value` is a live read of
the **accepted JavaScript publication**. Native editing may be ahead of that
publication; read the event's input value for the edit that triggered a handler.
`getAttribute('value')` reads the static attribute rather than the live slot.

Refs bind after native acceptance and before component effects. Rejected or
canceled candidate scenes never bind refs. Shared ref cleanup clears assignment
refs and runs callback ref disposers when their owners retire. A previously
captured handle can remain in user code, but `isConnected` then becomes false.
It provides no native mutation methods.

The following browser capabilities are **not implemented on desktop refs**:

- Tree traversal: `parentNode`, `children`, `childNodes`, `contains`, or selectors.
- DOM mutation: `appendChild`, `remove`, `textContent`, `innerHTML`, or attribute setters.
- Mutable property collections: `style`, `classList`, and `dataset`.
- Imperative control APIs: `focus()`, `blur()`, `click()`, and `scrollIntoView()`.
- Geometry APIs such as `getBoundingClientRect()` and element scroll properties.
- Listener registration through `addEventListener()` or `removeEventListener()`.
- A browser `Document`, DOM constructor identity, or `instanceof HTMLElement`.

Native input focus, scrolling, and event handling exist in the renderer. Their
existence does not imply an equivalent imperative ref API.

### Event target snapshots

Events use [runtime/event-dispatch.ts](src/runtime/event-dispatch.ts) and
[runtime/events.ts](src/runtime/events.ts). Each target snapshot contains the
static attributes, `id`, uppercase `tagName`, and `value`. Native input fields can
override these with newer editing data, including selection/composition fields
when supplied by the host. Ancestor snapshots represent their own elements.

These snapshots do not have ref methods or live identity. `target` represents the
originating element; `currentTarget` represents the element whose handler is
running. `currentTarget` becomes `null`, `eventPhase` becomes zero, and the event
path is cleared after synchronous dispatch. Capture a needed value before an
`await`:

```tsx
<input
  type="text"
  value={title}
  onInput={async (event) => {
    const nextTitle = event.currentTarget.value;

    title = nextTitle;
    await saveTitle(nextTitle);
  }}
/>
```

## Supported tags and content

[rust/src/tags.rs](rust/src/tags.rs) is the authoritative tag registry.
[rust/src/template.rs](rust/src/template.rs) validates the content model; the
GPUI adapter implements the presentation and native controls.

| Category | Implemented tags | Contract |
| --- | --- | --- |
| Flow containers | `div`, `form`, `article`, `aside`, `main`, `nav`, `section`, `header`, `footer`, `address`, `blockquote`, `figure`, `figcaption`, `dd`, `dl` | Contain supported flow content |
| Text blocks | `p`, `pre`, `h1`–`h6`, `dt` | Contain supported phrasing content and form native text groups |
| Inline text | `span`, `b`, `strong`, `i`, `em`, `cite`, `dfn`, `var`, `code`, `kbd`, `samp`, `abbr`, `data`, `time`, `mark`, `s`, `del`, `u`, `ins` | Contribute styled runs within a text group; no independent layout box |
| Lists | `ul`, `ol`, `li` | List containers accept list items; `li` requires a list parent |
| Button | `button` | Native activation/focus and phrasing content |
| Input | `input` | Empty native text control; only omitted `type` or `type="text"` |
| Empty elements | `br`, `hr` | Paragraph line break and block separator |

The registry also lists recognized but unfinished HTML tags. That catalogue does
not enable them. For example, `a`, `label`, `img`, `textarea`, `select`, tables,
canvas, SVG, media, and dialogs remain unsupported.

There is no browser parser repairing invalid nesting. Fragment roots and
component roots are checked at their actual placement. Inline text from separate
component roots does not automatically merge into one paragraph shaping group.
Native controls and text expose some accessibility behavior; full HTML landmark,
labeling, selection, and control semantics are not established by a tag name.

## JSX attributes and properties

The current compiler contract lives in
[lower-scene.ts](../compiler/src/desktop/lower-scene.ts).

| Attribute | Accepted form | Behavior |
| --- | --- | --- |
| `class`, `className` | Static string | Both normalize to the scene's `class` attribute |
| `id`, `title`, `aria-label` | Static string | Retained attributes; native behavior depends on the implemented tag/control |
| `style` | Static CSS string or object with static string/number values | Parsed declarations passed to native CSS adaptation |
| `type` | Static string on `input` or `button` | Text input validation; button activation/submission behavior |
| `placeholder` | Static string on `input` | Native text input placeholder |
| `value` | Static string or primitive expression on `input` | Expression becomes a mutable value slot |
| `ref` | Supported assignment or callback ref expression | Uses shared ref planning and accepted native handle lifecycle |
| `key` | Supported key expression on a keyed list row | Structural identity; not a native attribute |
| Event attributes | Supported callback expression | Registers an event site and owned callback |

Dynamic class names, dynamic IDs, dynamic inline styles, arbitrary `data-*` or
ARIA attributes, JSX attribute spreads, and other browser properties are not
implemented by this contract. `title` retention alone does not implement a
browser tooltip. A string `type` passing compiler checks does not establish all
HTML button/input modes; native validation remains required.

Style object names normalize from camelCase to CSS property names. Nonzero numeric
values receive `px`, except `opacity`, `lineHeight`, `fontWeight`, `flexGrow`, and
`flexShrink`. Values must still be valid for the corresponding native property.

Text slots accept strings, numbers, and bigints. Null, undefined, and booleans
produce empty text. Objects, arrays, functions, and promises are not text values.

## Events and defaults

| Authored handler | Scene event | Restrictions or defaults |
| --- | --- | --- |
| `onClick` | `click` | Supported non-inline elements; native button activation |
| `onInput`, `onChange` | `change` | Text input only; aliases for the same site, not separate browser input/change timing |
| `onKeyDown`, `onKeyUp` | `keydown`, `keyup` | Supported non-inline elements; keyboard fields supplied by the host |
| `onPointerDown`, `onPointerUp` | `pointerdown`, `pointerup` | Supported non-inline elements; pointer fields supplied by the host |
| `onFocus`, `onBlur` | `focus`, `blur` | Supported non-inline elements; non-bubbling and noncancelable |
| `onSubmit` | `submit` | `form` only; authored submission callback |

Event objects expose `type`, `target`, `currentTarget`, `bubbles`, `cancelable`,
`isTrusted`, `timeStamp`, `eventPhase`, `defaultPrevented`, `cancelBubble`, and
`returnValue`. They implement `preventDefault()`, `stopPropagation()`,
`stopImmediatePropagation()`, `getModifierState()`, and `composedPath()`.
Other fields come from the native payload; a browser event type does not guarantee
every field is present. Capture-phase JSX handlers are not implemented.

| Native payload | Currently supplied fields |
| --- | --- |
| Keyboard | `key`, `repeat`, `isComposing`, `ctrlKey`, `shiftKey`, `altKey`, `metaKey`, `cancelable` |
| Pointer | `clientX`, `clientY`, `button`, `buttons`, `pointerId`, `pointerType`, `isPrimary`, modifier keys, `cancelable` |
| Click | Pointer fields plus `detail` |
| Text input target | `value`, `selectionStart`, `selectionEnd`, `isComposing`; selection offsets count UTF-16 code units |

The pointer adapter currently represents a mouse with pointer ID 1. Pointer
notifications are noncancelable; click activation is cancelable. Keyboard `code`,
touch/pen metadata, and the full browser event field set are not supplied.

Bubbling follows authored ancestors across component attachment regions.
`change` is noncancelable because the native edit has already happened. Button
Enter/Space activation and form submission defaults respect cancellation.
Enter in a text input can submit its ancestor form. Forms do not implement browser
navigation, HTTP submission, `FormData`, or HTML constraint validation.

Async callbacks are supported. The native event acknowledgment does not wait for
the whole callback to finish; writes around explicit `await` boundaries publish
through the shared reactive core. Default-action cancellation must happen during
synchronous dispatch. Generator callbacks remain unsupported.

## CSS and layout

Use ordinary imported CSS, including CSS produced by a library's build step.
The compiler parses rules, Rust matches selectors and computes the cascade, and
the GPUI style adapter translates supported values into GPUI refinements.
GPUI/Taffy performs layout; Taffy is not a complete browser CSS parser or engine.

Supported selector forms are tag/universal, class, ID, selector lists, and
descendant, child, adjacent-sibling, and general-sibling combinators. Matching
crosses transparent component regions. Target `:hover` and `:focus` are supported;
the compiler also accepts its generated class scope form `:where(.scope)`.
General functional/attribute selectors, pseudo-elements, nested rules, and
at-rules such as `@media` are not implemented.

| Property family | Current native coverage |
| --- | --- |
| Layout and sizes | `display` block/flex/grid/none; width/height and min/max sizes |
| Spacing | Margin, padding, row/column gap and their supported shorthands |
| Flex | Basis, grow, shrink, direction, wrap, align-items/self/content, justify-content |
| Position and overflow | Relative/absolute position, top/right/bottom/left, overflow and axis variants |
| Grid | Row/column templates representable as 1–64 equal `1fr` or `minmax(0, 1fr)` tracks; arbitrary track plans are rejected |
| Paint | Background color, border color/style/width, corner radii, opacity, cursor |
| Text | Color, font family/size/weight/style, line height, white space, text alignment, underline/line-through |

Lengths generally support `px`, `rem`, percentages, zero, and `auto` where the
property permits them. Property-specific checks further restrict these values.
Inline text supports a smaller refinement set: color, background color, font
family/weight/style, and supported text decorations. Inline box sizing, per-span
font sizes, and inline interaction styles require further implementation.

The exact value adapters are in [gpui/src/styles.rs](rust/gpui/src/styles.rs),
shorthand/cascade handling in [rust/src/css.rs](rust/src/css.rs), and selector
lowering in [compiler/desktop/css.ts](../compiler/src/desktop/css.ts). Unsupported
properties and values receive diagnostics rather than silently becoming browser
behavior. Headless scene CSS acceptance alone does not prove that the GPUI window
can represent a declaration.

Tailwind and other CSS libraries need no special desktop authoring dialect. Their
**generated CSS** must fit this implemented subset or be transformed by their
build pipeline. Compilation to CSS alone does not make custom properties,
unsupported selectors, at-rules, or unsupported values available in the renderer.

## Runtime and lifecycle contract

The desktop adapter shares the framework's access tables, source identities,
module state cells, dependency routing, control-flow calculations, effects, and
cleanup ownership. Linked relative modules can share reactive state and helpers
across component instances. Supported module cell defaults follow the shared
compiler's scalar/literal-store initialization rules. Separate desktop applications
have separate cells even when they load the same compiled module. Uncompiled
consumers of raw ESM exports do not get application-cell live reads.

Setup calculations replay before destination reads. Components have independent
owners; inline structural fragments share their enclosing lexical state. Child
props currently accept primitives and owned callbacks, including async callbacks.
Render-prop callbacks and general object props are not implemented. Component
factories and list-row construction remain synchronous. Keyed rows require unique
string or finite number keys and retain their owners across reordering.

Native publication is asynchronous. Accepted slot/prop/topology caches advance
only after acknowledgment. Rejected publication leaves the accepted scene intact
and preserves retryable work; it does not roll back authored state mutations.
Refs and effects wait for acceptance. `$effect` uses shared dependency and cleanup
semantics; `$cleanup` registers owner teardown. Removed owners suppress late
callbacks, release descendants, and dispose their registered resources.

For host integrations, `DesktopApplication` exposes `run`, `mount`, `dispatch`,
`dispatchEvent`, `flush`, and `dispose`. Execute programmatic mutations inside
`app.run(callback)` to select the owning application. A `SceneInstance` exposes
`entityId`, `handle`, `ready`, `mounted`, `invalidate`, `flush`, `dispatch`, and
`dispose`; these are component-owner APIs, not element methods. A normal mounted
`DesktopRoot` additionally has `rootId` and `unmount()`.

Provider replay, shared volatile-pull integration, arbitrary package graphs beyond the
linked relative graph, and direct re-export-from syntax remain integration
boundaries. Browser globals and DOM-dependent libraries require explicit target
adaptation. The desktop build does not create a DOM for them.

## Third-party libraries

Compatibility depends on what a library uses, not whether it was installed from
npm. JavaScript libraries continue to execute in Bun; they do not need to be
rewritten in Rust merely because the presentation target is native.

| Library category | Current contract |
| --- | --- |
| Utilities, validation, parsing, formatting, and data processing | Can run when compatible with Bun and their required APIs; normal package resolution/bundling applies |
| Network, storage, filesystem, and native addons | Depend on Bun/platform support and the package's actual API requirements; desktop does not emulate browser-only storage or extension APIs |
| Headless state, form, or query libraries | Their JavaScript may run; desktop still needs to wire the existing compiler external-source analysis, subscriptions, and shared opaque-value pull capability |
| Libraries that create or inspect DOM nodes | Cannot use desktop ref handles as browser elements; require a native adapter or an alternative implementation |
| Memoized DOM component packages | Need components compiled for this target or supported source/package linking, plus implemented tags, attributes, and CSS; arbitrary package component linking is not established yet |
| CSS libraries | Generated CSS enters the normal CSS pipeline and must fit the supported features described above |

There are two separate build boundaries. In
[dev/build.ts](src/dev/build.ts), Bun resolves and bundles package imports, but
the desktop semantic graph's module reader currently follows **relative imports
only**. Package internals consequently do not receive our state cells, access
tables, write instrumentation, or component metadata. Ordinary third-party
libraries do not need those transformations to be compatible: the framework
tracks application reads and writes around external values. Package component
linking is a separate concern from external-state observation. Unknown external
calls already receive conservative shared compiler effect summaries.

Web already implements two complementary external-value paths. Shared analysis
in [external-reactivity.ts](../compiler/src/analysis/external-reactivity.ts)
records configured subscription contracts. Shared
[opaque-volatility.ts](../compiler/src/analysis/opaque-volatility.ts) identifies
opaque dependencies, and the runtime's [volatile.ts](../runtime/src/volatile.ts)
reevaluates registered volatile entities through the application's scheduling
environment. This fallback can observe changing external values without a
library subscription or changes to its published JavaScript.

Desktop has not yet wired these paths fully: its compiler omits those analysis
passes, and its semantic runtime uses `schedule: null` and direct entity
registration. Consequently, library-owned asynchronous changes do not currently
refresh desktop destinations automatically. The required work is to reuse the
existing contracts and runtime capability, emit the appropriate scene-owner
subscriptions/volatile registration, and supply native frame and visibility
scheduling. Subscription callbacks must retain application ownership, and
disposal must use the existing cleanup machinery. A separate desktop external
store or subscription system is not required.

Ordinary application callbacks can already call compatible library functions and
assign results to compiled application state. Uncompiled package singletons
retain their normal JavaScript sharing semantics; per-application cell isolation
applies to compiled state, not automatically to those singletons.

Package integration should distinguish inert external dependencies, packages
whose Memoized DOM source/metadata participates in compilation, and libraries
connected through explicit subscriptions or native capabilities. Supporting
package component resolution requires package exports and target selection,
dependency identity, stylesheet handling, and real packaged fixtures. It should
not be implemented by compiling every dependency indiscriminately or pretending
that a DOM library receives a browser element.

## Typing and extending the contract

Applications use the framework's ordinary JSX and DOM event authoring types.
**Those types currently describe a broader browser surface than desktop supplies.**
For example, a ref typed `HTMLInputElement` can offer `focus()` in the editor even
though the actual desktop ref object has no such method. This is a known typing
gap, not a supported native API. Compiler diagnostics, native validation, and the
capabilities listed here determine current behavior. Target capability checking
must be improved before the editor can reliably reject every browser-only use.

When extending desktop, update the relevant contract and this README together:

1. Define tag content/presentation in the Rust registry, or define an explicit ref,
   event, attribute, or CSS capability in its owning module.
2. Implement compilation, retained/native validation, rendering, and lifecycle or
   interaction behavior as needed. Include accessibility behavior for controls.
3. Verify rejection and acceptance, retained identity, retirement, and actual
   native window behavior. Browser comparisons can check intended CSS behavior.
4. Document the accepted values and limitations here. Recognition or successful
   JSX type-checking alone must not be described as implementation.

`DesktopProcessHost` snapshots and native test commands expose geometry, focus,
editing, style, and timing information for debugging. They are host/testing APIs,
not methods available on application element refs.

Run the desktop suite with `bun run test:desktop`. The native window smoke commands
are `bun run desktop:test:window` and `bun run desktop:test:todo` from the root.
After building, shared-state native verification can also be run with:

```sh
bun run ./packages/desktop/examples/window.ts --entry=./packages/desktop/examples/shared-state/main.ts --reactivity-smoke
```
