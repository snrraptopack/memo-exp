# Memoized DOM desktop

This package adapts the framework's compiled components and shared reactive core
to a retained Rust scene rendered by GPUI. Applications use TSX, ordinary CSS,
and the normal `mount` API. Rust owns tag semantics, text preparation, native
controls, layout, and painting.

Application authoring follows the core web framework. Desktop implements those
contracts inside its host adapter, including ordinary ref method names and return
types. Unsupported browser capabilities remain implementation gaps to close in
the adapter; shared application code should not gain native helper imports or
additional awaits to use an existing web operation.

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
bun run desktop:inline
```

These commands build the shared runtime, compiler, desktop adapter, and native
window executable. The examples exercise controls and component/list ownership,
todo interactions and styling, cross-module state, and inline element boxes
respectively. The inline example checks sizing, hover, pointer events, and a grid
inside a span using ordinary CSS and the normal mount entry.

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
data. Updates carry slot writes, complete element-property replacements, and structural
operations instead of replacing the template.

Live instance identity is `{ id: number, generation: number }`, called a
`SceneHandle`. Identify an element with **both the instance handle and its template
node index**. A node index alone is not globally unique, and a retired generation
must not receive events. Template IDs, application root names, instance handles,
and authored `id` attributes identify different things.

### Ref handle properties

The exported `SceneElement` contract is defined in
[runtime/application.ts](src/runtime/application.ts) and created in
[runtime/lifecycle.ts](src/runtime/lifecycle.ts):

| Property or method | Current behavior |
| --- | --- |
| `handle` | Owning instance's `{ id, generation }` |
| `node` | Element index within its template |
| `tagName` | Uppercase authored tag, such as `'INPUT'` or `'P'` |
| `isConnected` | Live getter; true while its owner is mounted and not disposed |
| `ownerDocument` | Always `null`; used by shared ref lifecycle checks |
| `id` | Accepted `id`, or `''` |
| `value` | Latest acknowledged value slot, otherwise static `value`, otherwise `''` |
| `getAttribute(name)` | Accepted attribute value, or `null`; use normalized names such as `'class'` |
| `measure()` | Internal adapter/test read of completed native geometry; not a browser authoring API |
| `focus()` | Requests focus on a retained native input/button and returns `void` |
| `blur()` | Requests blur of this ref's focused control and returns `void` |

The object is frozen, and its properties are read-only. `value` is a live read of
the **accepted JavaScript publication**. Native editing may be ahead of that
publication; read the event's input value for the edit that triggered a handler.
`getAttribute('value')` reads the accepted property attribute when the input uses a property bag, or its template attribute otherwise. `value` reads the accepted value slot when one exists.

Refs bind after native acceptance and before component effects. Rejected or
canceled candidate scenes never bind refs. Shared ref cleanup clears assignment
refs and runs callback ref disposers when their owners retire. A previously
captured handle can remain in user code, but `isConnected` then becomes false.

Application refs use the ordinary methods, such as `input.focus()` and
`input.blur()`. There are no desktop helper imports for these operations.
Synchronous browser geometry methods remain a capability gap. The native
measurement transport and `SceneElement.measure()` currently serve adapter and
native contract tests, rather than a separate application authoring pattern.

`SceneMeasurement` includes the owning `handle`, source `node`, accepted
`sequence`, completed `frame`, `rects`, and nullable union `bounds`. Coordinates
are window-relative logical pixels. Independent elements report their native
layout boxes; unboxed inline sources report shaped glyph fragments, including
each wrapped line. Geometry is not clipped to the viewport, so scrolling can
produce negative coordinates. An empty or unpainted source in a completed scene
has no rectangles and `bounds: null`.

Measurement runs after publications already requested on the application
connection. It waits for paint if that accepted scene has not painted yet;
otherwise it reads the last completed frame. It does not implicitly flush local
state writes or promise a future resize/hover frame. Call `await app.flush()`
before measuring when you need pending application changes accepted. A ref
retiring during the request rejects the read. Hosts supply the optional
`DesktopHost.measure` capability; the headless process explicitly refuses it.
This asynchronous API does not implement synchronous browser geometry methods.
`input.focus()` and `input.blur()` use the retained GPUI focus
handles, input entities, and focus/blur subscriptions as pointer and keyboard
interaction. Repeated focus is idempotent; blurring an unfocused ref leaves the
currently focused control alone.

```tsx
let input: HTMLInputElement | undefined;

function focusInput() {
  input?.focus();
}

return <input ref={input} />;
```

Both methods return `void`, matching the browser authoring contract. Native
transport acknowledgment and control preparation belong to the adapter. Author
code adds no awaits, imports or native ref types. Native transport failures use
the existing asynchronous application error boundary. The native operation is
delivered through the process connection; synchronous browser document queries
such as `document.activeElement` remain outside the implemented desktop surface.

Focus commands run after publications already requested on the connection.
Initial callback refs can request focus immediately on acceptance: the native
adapter waits for the control to be prepared, rechecking its live generation
before applying focus. The internal acknowledgment confirms the native focus operation;
the resulting events, reactive writes and focus styling settle through the usual
event/publication/paint path. The command itself does not advance the scene
sequence. Focus and blur are control operations; they do not introduce a new
reactive write or an application publication step.

Only native inputs and buttons currently provide focusability. Nonfocusable
elements and disconnected refs are inert, as on the web. Stale native protocol
addresses reject internally. The optional adapter host capability is
`DesktopHost.setFocus(handle, node, focused)`; headless hosts refuse it. Browser
focus options reject explicitly. Arbitrary `tabIndex` targets and implicit scrolling are not
implemented. **Focus input ref** and **Blur input ref** in the inline TSX example
exercise these capabilities with ordinary input refs and reactive event counts.

The following browser capabilities are **not implemented on desktop refs**:

- Tree traversal: `parentNode`, `children`, `childNodes`, `contains`, or selectors.
- DOM mutation: `appendChild`, `remove`, `textContent`, `innerHTML`, or attribute setters.
- Mutable property collections: `style`, `classList`, and `dataset`.
- Imperative control APIs beyond the input/button focus contract: `click()` and `scrollIntoView()`.
- Geometry APIs such as `getBoundingClientRect()` and element scroll properties.
- Listener registration through `addEventListener()` or `removeEventListener()`.
- A browser `Document`, DOM constructor identity, or `instanceof HTMLElement`.

Input/button ref focus uses the contract above. Scrolling and event handling in
the renderer do not yet establish other imperative browser ref methods.

### Event target snapshots

Events use [runtime/event-dispatch.ts](src/runtime/event-dispatch.ts) and
[runtime/events.ts](src/runtime/events.ts). Each target snapshot contains the
accepted attributes, `id`, uppercase `tagName`, and `value`. Native input fields can
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
| Inline text | `span`, `b`, `strong`, `i`, `em`, `cite`, `dfn`, `var`, `code`, `kbd`, `samp`, `abbr`, `data`, `time`, `mark`, `s`, `del`, `u`, `ins` | Contribute styled runs in block/paragraph flow; direct flex/grid children retain separate items |
| Lists | `ul`, `ol`, `li` | List containers accept list items; `li` requires a list parent |
| Button | `button` | Native activation/focus and phrasing content |
| Input | `input` | Empty native text control; only omitted `type` or `type="text"` |
| Empty elements | `br`, `hr` | Paragraph line break and block separator |

The registry also lists recognized but unfinished HTML tags. That catalogue does
not enable them. For example, `a`, `label`, `img`, `textarea`, `select`, tables,
canvas, SVG, media, and dialogs remain unsupported.

There is no browser parser repairing invalid nesting. Fragment roots and
component roots are checked at their actual placement. Components, forwarded
children, conditionals, and keyed inline rows inside `p`, `span`, headings, or
button labels contribute to their enclosing paragraph's shaping input. Inline
styles retain their original element/owner sources. In a flow container, Rust
expands component and fragment roots before grouping adjacent text and inline
elements. A block or control splits that anonymous paragraph. Flex/grid keeps
each direct authored element as a separate item and groups only adjacent raw
text. Component boundaries contribute no layout wrapper. Independent mounted
application roots keep separate formatting contexts.
A single authored element root keeps its native source and ID, including an
inline root presented as a standalone paragraph.
Native controls and text expose some accessibility behavior; full HTML landmark,
labeling, selection, and control semantics are not established by a tag name.

## JSX attributes and properties

Rust owns the supported tag, attribute and event constraints in
[rust/src/tags.rs](rust/src/tags.rs). The compiler and runtime consume its
checked-in [capabilities projection](src/scene/capabilities.json). Regenerate it
with `bun run --cwd packages/desktop capabilities:generate` after changing the
Rust contract; the Rust suite checks for drift. Ordinary TypeScript builds need
no Cargo toolchain.

[attributes.ts](../compiler/src/desktop/attributes.ts) translates the shared
ordered-attribute plan into static template fields or reactive property bindings.

| Attribute | Accepted form | Behavior |
| --- | --- | --- |
| `class`, `className` | Static or reactive primitive value | Both normalize to the scene's `class` attribute |
| `id`, `title`, `aria-label` | Static or reactive primitive value | Retained attributes; native behavior depends on the implemented tag/control |
| `style` | Static or reactive CSS string or object with string/number values | Parsed declarations passed to native CSS adaptation |
| `type` | Static or reactive string on `input` or `button` | Text input validation; button activation/submission behavior |
| `placeholder` | Static or reactive primitive value on `input` | Native text input placeholder |
| `value` | Static string or primitive expression on `input` | Expression becomes a mutable value slot; an ordered property bag publishes the accepted value attribute |
| `ref` | Supported assignment or callback ref expression | Uses shared ref planning and accepted native handle lifecycle |
| `key` | Supported key expression on a keyed list row | Structural identity; not a native attribute |
| Event attributes | Supported callback expression | Registers an event site and owned callback |

Compiler event validation and handler emission live in
`packages/compiler/src/desktop/events.ts`. Runtime property-bag callback handling
lives in `src/runtime/property-events.ts`; dispatch and propagation remain in
`src/runtime/event-dispatch.ts`. Attribute lowering calls these event modules.
Rust's capability projection determines which event types each tag accepts.

JSX attribute and component-prop spreads preserve source order: later entries
replace earlier values, including `className`/`class` and `onInput`/`onChange`
aliases. Each spread is copied once per property read; getters are not re-run
for each field. Omitted, null or false host attributes remove earlier accepted
values. Dynamic properties update the existing native element without remounting
its children. Stylesheet matching is refreshed when class, ID or inline CSS
changes; input-value edits retain the existing cascade and paragraph caches.

Spread handlers and refs stay in JavaScript. Their accepted identities change
after native acknowledgment, so a refused transaction preserves the previous
handlers and ref capabilities. A spread `ref` value uses the core callback or
callback-array contract; an explicit assignable JSX `ref` still uses the shared
compiler adapter. Component spreads follow the same JavaScript data, owned
callback, and compiled content contracts as named component props.

Arbitrary `data-*` and ARIA attributes, class-map objects, and additional browser
properties remain unsupported. Known named attributes fail at compilation;
unsupported names originating from runtime spreads fail before publication.
`title` retention alone does not implement a browser tooltip. Native validation
still rejects unsupported input types and CSS values.

Finite dynamic JSX tags use the shared tag-selection planner. For example,
`const Tag = compact ? 'section' : 'article'; return <Tag />` creates a conditional
scene region. Local or linked component candidates and member-selected tags use
the same path. Keeping a selected component preserves its state; changing the
selected branch uses staged replacement and deterministic retirement. Arbitrary
runtime tag names without a provable finite candidate set are rejected.
Component children and structural render callbacks use the composition contract below.

Style object names normalize from camelCase to CSS property names. Nonzero numeric
values receive `px`, except `opacity`, `lineHeight`, `fontWeight`, `flexGrow`, and
`flexShrink`. Values must still be valid for the corresponding native property.

Text slots accept strings, numbers, and bigints. Null, undefined, and booleans
produce empty text. Objects, arrays, functions, and promises are not text values.

## Events and defaults

| Authored handler | Scene event | Restrictions or defaults |
| --- | --- | --- |
| `onClick` | `click` | Native boxes and measured inline text sources; native button activation |
| `onInput`, `onChange` | `change` | Text input only; aliases for the same site, not separate browser input/change timing |
| `onKeyDown`, `onKeyUp` | `keydown`, `keyup` | Supported non-inline elements; keyboard fields supplied by the host |
| `onPointerDown`, `onPointerUp` | `pointerdown`, `pointerup` | Native boxes and measured inline text sources; pointer fields supplied by the host |
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

Pointer release precedes click for native mouse activation. GPUI processes its
click listener before the same element's mouse-up listener, so the event adapter
delivers both before stopping native propagation. Keyboard activation emits a
click without inventing a pointer release. Authored bubbling remains in the
shared JavaScript runtime.

Paragraph pointer routing uses GPUI's shaped glyph clusters, UTF-8 source ranges,
wrap boundaries, and actual alignment. The innermost inline element under a
glyph becomes the target; the existing runtime resolves its authored event path
across component owners. Press/release history retires during native capture,
including releases outside the paragraph. Clicks within a paragraph select the
common inline ancestor of the pressed and released source, or its containing
element. A button keeps native focus and its submit default when its label's
inline element becomes the pointer target.

`host.inspect().renderer.inline_ranges` contains measured source fragments;
wrapped elements can have several. They are text regions, not independent layout
boxes. `inline_geometry` counts region preparation. Geometry is retained with
shaping and translated during prepaint, so an unchanged redraw reuses it.
`inline_hovered` lists the source ancestry whose hover refinements were used by
the painted frame. These inspection fields do not add browser geometry methods
to native ref handles.
`inline_cursor` records the measured source and cursor request submitted to GPUI,
or `null` when the enclosing native box supplies the cursor. It reports GPUI
requests (`Arrow`, `IBeam`, `PointingHand`), not the operating system's cursor.
Hit tests treat a shaped glyph cluster as one unit, matching GPUI's byte-index
model; character-level hit divisions inside a ligature are not exposed.

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
Inline text inside a paragraph supports a smaller refinement set: color,
background color, font family/weight/style, and supported text decorations.
Target `:hover` applies that same refinement set to measured paragraph sources,
including nested inline ancestry across component owners. Hover stays in native
presentation state and works without a JavaScript event handler. Moving within
one source reuses its shaped text; changing font weight or family reshapes through
GPUI. Leaving the source restores its normal refinements. Scrolling, resizing,
and accepted text changes recheck the source under the stationary pointer.
Prepaint retires hover on fully clipped paragraphs; deferred native notification
requests the frame that restores normal text after a draw-time hover change.
Paragraph sources also support `cursor: pointer`, `text`, `default`, and `auto`
(the latter two map to GPUI's arrow), including target `:hover` overrides. The
nearest explicit inline declaration wins across component owners. An explicit
default cancels an ancestor's hand/text cursor; an omitted declaration inherits
from inline ancestry, then falls through to the enclosing native box. Cursor
requests apply only over the source's measured glyphs. Cursor-only source changes
request a native paint while reusing text shaping and glyph geometry; no event
handler or application write is required.
Paragraph-run box sizing, per-run font sizes, and `:focus` styling
require further implementation. An inline element with its own native box supports the
ordinary box properties above, including padding, dimensions, font size, and
hover styling. Its placement determines this capability; a tag name alone does
not. A boxed span with `display: flex` or `display: grid` also lays out its own
phrasing children as separate items.

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
props accept primitives, ordinary JavaScript objects and arrays, owned callbacks
(including async callbacks), and compiler-owned content. Objects retain their
identities in JavaScript. When their parent publishes an invalidation, child reads
refresh conservatively so an in-place edit is visible. These values are not
serialized to Rust, cloned, proxied, or made reactive by passing them as props.
Component factories and list-row construction remain synchronous. Keyed rows require unique
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

Provider replay, arbitrary package graphs beyond the linked relative graph,
and direct re-export-from syntax remain integration
boundaries. Browser globals and DOM-dependent libraries require explicit target
adaptation. The desktop build does not create a DOM for them.

## Component children and render callbacks

Use ordinary TSX for nested children or a named JSX content prop:

```tsx
function Panel({ children }) {
  return <section class="panel">{children}</section>;
}

function Collection({ items, renderItem }) {
  return <ul>{items.map((item, index) => renderItem(item, index))}</ul>;
}

function App() {
  let count = 0;
  let items = [{ id: 'first', title: 'First task' }];

  return (
    <Panel>
      <button onClick={() => count++}>{count}</button>
      <Collection
        items={items}
        renderItem={(item, index) => (
          <li key={item.id}>
            <p>{item.title}: {count}: {index}</p>
          </li>
        )}
      />
    </Panel>
  );
}
```

The compiler turns this content into deferred retained factories. Forwarding a
content or callback prop preserves its declaring owner. A handler in the content
writes the component that authored it; a named component inside the content owns
its own state. Repeated placements receive separate retained instances.

Collection callbacks take an item binding pattern and optional index, synchronously
return one JSX element, and supply an explicit string or finite-number key.
The collection forwards its item and optional index directly. Reordering preserves
row handles and named descendant state. Changes to caller values used in callback
keys also replay the collection reader.

The internal `SceneContent` value is opaque compiler metadata, separate from a
native element or browser node. It stays in JavaScript alongside data props and
callbacks. Rust receives the existing mount, update, dispose, and order operations.
Templates are installed without running inactive content setup. Native acceptance
controls ref/effect activation; canceled candidates clean up their setup once.

Composition discovery, callback normalization, and whole-project scalar/content
resolution are shared with the DOM compiler. Scalar caller evidence keeps an
untyped imported prop scalar. Discovery retains provisional export candidates;
desktop emission requires positive JSX caller evidence before turning an
unobserved untyped export into a structural slot. Native regions can occupy
phrasing containers as well as flow/list containers. Rust validates actual roots
through forwarding regions: an inline child can join a paragraph or button label,
while a block or control in that position rejects the whole transaction.
Named JSX-returning helper callbacks, arbitrary callback
selection expressions, and JSX stored in setup variables remain outside the
desktop emission contract.

Rust retains cross-component text plans in [rust/src/composition.rs](rust/src/composition.rs).
Topology changes rebuild their source paths; ordinary edits revisit only groups
depending on the changed owner. Complete text and UTF-8 run boundaries prepare
before native acceptance. Rejection preserves text, revisions, and dependency
plans; multiple writes restored to their original value in one transaction leave
the revision unchanged. Embedded content keeps its component identity and
lifecycle, and contributes no extra text box in GPUI.

[rust/src/flow.rs](rust/src/flow.rs) retains the accepted scene-level layout after
transparent regions are expanded. It reuses the source walker and text comparison
above; it does not create application state, subscriptions, or reactive owners.
Topology changes and accepted CSS changes between block and flex/grid regroup
placed content. Ordinary edits reuse the layout and source paths and refresh its
dependent text groups. Empty anonymous groups stay subscribed but create no
native box or flex/grid gap. The plan records independently boxed inline nodes
for native CSS and event validation. Installation validates CSS syntax; mounting
validates placement-dependent capabilities. When regrouping changes those
capabilities, the adapter rechecks untouched children before replacing any style
cache. Unsupported sizing or focus styles on flattened paragraph runs reject the
transaction; the previous layout, values, and native caches remain accepted.
Hover/focus CSS that changes between block and flex/grid rejects explicitly;
regrouping in response to native interaction states is still unimplemented.

`host.inspect().flow` exposes the actual placed `items` and `text_groups` consumed
by GPUI. Each item's `source` names its authored owner handle and node. `parent`
indexes another placed item; `group` indexes the scene's accepted text groups.
An anonymous paragraph has an `anchor` pointing to its first inline source and
inherits through its surrounding container. It copies no authored ID or event
target. Per-instance `presentation` and `text_groups` remain local template
projections; they do not describe the final grouping across component boundaries.
An empty scene omits `flow`. Shaping cache identity includes the actual text as
well as the revision and geometry/style inputs, so disappearing and returning
groups cannot reuse lines for different content with the same initial revision.

## Third-party libraries

Compatibility depends on what a library uses, not whether it was installed from
npm. JavaScript libraries continue to execute in Bun; they do not need to be
rewritten in Rust merely because the presentation target is native.

| Library category | Current contract |
| --- | --- |
| Utilities, validation, parsing, formatting, and data processing | Can run when compatible with Bun and their required APIs; normal package resolution/bundling applies |
| Network, storage, filesystem, and native addons | Depend on Bun/platform support and the package's actual API requirements; desktop does not emulate browser-only storage or extension APIs |
| Headless state, form, or query libraries | Application reads use shared external-source analysis: configured subscriptions publish source keys, and opaque values can use shared visible-frame pulls |
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

Both targets use two complementary external-value paths. Shared analysis
in [external-reactivity.ts](../compiler/src/analysis/external-reactivity.ts)
records configured subscription contracts. Shared
[opaque-volatility.ts](../compiler/src/analysis/opaque-volatility.ts) identifies
opaque dependencies, and the runtime's [volatile.ts](../runtime/src/volatile.ts)
reevaluates registered volatile entities through the application's scheduling
environment. This fallback can observe changing external values without a
library subscription or changes to its published JavaScript.

Desktop runs those same analysis passes. Configured subscription adapters activate
after the scene owner is accepted. Their callbacks re-enter the captured core
application, publish the canonical source key, and invalidate the subscribing
owner. Core cleanup releases subscriptions when the owner retires; late callbacks
ignore retired owners. Library-owned values remain library-owned and are not
replaced with application state cells.

Subscriptions needed by module calculations or module effects belong to the core
application lifetime. This includes calculations in a state-only file imported
through a barrel. They remain active after an individual scene reader unmounts
and are released when the application is disposed. Direct component-only sources
retain the accepted component lifetime described above.

Opaque scene owners register through core's existing volatile capability. The
process window host supplies `nextFrame()` and native visibility, without a
browser document. A clock request is acknowledged immediately; a separate frame
message resolves it when GPUI runs the next frame. Hidden frames do not pull
values. Headless/custom hosts that omit `nextFrame` do not automatically poll
opaque values; explicit subscriptions still work there. Observable changes are
sampled on visible frames rather than promised as one callback per mutation.

The desktop build accepts the shared `externalReactiveSources` metadata. A
subscription adapter receives the imported value and a listener, and returns a
cleanup function. The library itself remains ordinary JavaScript. For example:

```ts
const externalReactiveSources = [
  {
    module: 'my-store',
    source: 'store',
    subscribe: { module: './store-adapter.ts', export: 'observeStore' },
  },
];
```

Pass this metadata to the desktop build or compiler options. Prefer a library's
subscription API for prompt updates; frame pulls are the existing conservative
fallback for opaque reads. These paths reuse core registration, access routing,
visibility scheduling, and cleanup rather than introducing a desktop state system.

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
For example, a ref typed `HTMLElement` can offer `scrollIntoView()` in the editor even
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
not imperative control methods available on application element refs. Geometry
reads currently use the adapter/test `SceneElement.measure()` capability;
synchronous browser geometry remains unimplemented.
Pointer test commands accept an optional `frame` from `renderer.frames`. Native
admission rejects a stale frame or an accepted scene awaiting paint before any
input is dispatched. The test driver can safely reinspect that rejection without
duplicating a click. Targets use a positive viewport intersection of an actual
painted box or glyph fragment; a wrapped source's first line need not be visible.
Fully offscreen, empty, and missing targets still reject. Matching uses both the
painted source's handle ID and generation.

Run the desktop suite with `bun run test:desktop`. The native window smoke commands
are `bun run desktop:test:window` and `bun run desktop:test:todo` from the root.
After building the window, `bun run --cwd packages/desktop test:inline` checks the
inline example through real GPUI hover, pointer, click, layout, and redraw paths.
After building, shared-state native verification can also be run with:

```sh
bun run ./packages/desktop/examples/window.ts --entry=./packages/desktop/examples/shared-state/main.ts --reactivity-smoke
```
