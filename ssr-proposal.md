# Memoized DOM SSR and Hydration Proposal

Status: proposal for debate  
Audience: compiler, runtime, router, data, and testing contributors  
Scope: server rendering, hydration, request isolation, and state transfer

This document is intentionally not a final specification. It records a staged
implementation proposal, the architectural constraints already visible in the
codebase, competing design choices, and the questions that must be resolved
before the public API is frozen.

## Executive summary

Memoized DOM should approach SSR in two layers:

1. Prove semantic correctness by running existing compiler output against a
   server DOM implementation such as LinkeDOM and comparing the result with
   client-side rendering.
2. Add a purpose-built string-writer document tier after the rendering and
   hydration contracts are understood.

HTML generation is not expected to be the hardest part. The difficult parts
are:

- isolating module-level state, runtime entities, router state, data caches,
  and effects between concurrent server requests;
- emitting enough stable identity for hydration without bloating every DOM
  node;
- adopting server nodes while rebuilding component closures, slot caches,
  list/conditional ownership, event handlers, refs, and effects;
- transferring async data and route state without duplicate client work;
- defining predictable recovery when server and client output disagree.

The proposed work sequence is:

```text
0. Freeze list specialization and push-invalidation behavior
1. Server-safe runtime isolation + LinkeDOM reference renderer + CSR parity
2. Hydration protocol + compiler marker emission
3. Hydration/adoption mode + manifest consumption + mismatch recovery
4. Production string-writer document tier
5. State transfer, concurrency hardening, and production readiness
6. Later: streaming and coordinated async route/data rendering
```

The ordering is deliberate. LinkeDOM provides a correctness oracle before a
second renderer is written. The hydration protocol is designed before marker
syntax is treated as stable. Streaming is deferred until synchronous SSR,
request isolation, and hydration are reliable.

## Why SSR fits the framework

Memoized DOM already has several properties that help SSR:

- The compiler knows the authored DOM structure ahead of time.
- Components have split creation and update behavior.
- Conditions, lists, routes, children, refs, effects, and cleanup have explicit
  compiler/runtime ownership.
- There is no virtual DOM tree that must be recreated and diffed.
- The compiler already assigns deterministic structural identities.
- Router and data packages expose isolated-runtime factories, even though
  their default exports are browser-oriented singletons.

These properties make deterministic server output and precise adoption
possible. They do not make hydration automatic. Current generated output is
browser DOM code, the runtime kernel is global, and authored module bindings
use ordinary ESM singleton semantics.

## Current architectural facts

The proposal should be evaluated against the implementation as it exists, not
against an idealized future architecture.

### Generated rendering

Compiled components currently create nodes through global `document` calls.
List and conditional regions also create comment anchors and document
fragments directly. This works in a browser or DOM emulator but not in a bare
server process.

### Root creation

The public mount layer already has a `RootMountContext`, but its mode is only
`'create'`. The compiler-generated root registration currently invokes the
root component without consuming that context. This is the natural seam for a
future creation/adoption mode, but it is not wired through the component ABI
yet.

### Runtime ownership

The kernel currently owns process/module-global registries, dirty sets,
volatile entities, scheduling state, and mounted-root bookkeeping. The browser
runtime also currently permits one mounted application. A server cannot safely
render concurrent requests through that shared state.

### Module-level application state

Memoized DOM deliberately allows state to live at module scope:

```ts
export let count = 0;
export const store = { selectedId: null };
```

In ordinary ESM evaluation, those bindings are singletons. Runtime context
isolation alone does not isolate them. `AsyncLocalStorage` can route runtime
operations to a request context, but it cannot make one ESM `let` binding hold
different values for two requests.

Preserving the promise that “state can live everywhere” is therefore the most
important SSR design problem.

### Effects and refs

Effects are post-render runtime entities and may return teardown. Refs receive
real nodes and follow structural ownership. On the server:

- refs generally must not run because there is no attached browser node;
- external effects generally must not run during HTML generation;
- module effects cannot be allowed to leak between requests;
- hydration must activate refs and effects only after adoption establishes
  their owners.

### Router and data state

The router exposes `createRouteRuntime()` and memory history. The data package
exposes `createDataRuntime()`. These are useful request boundaries.

The default `route`, `$fetch`, and `$action` exports are singleton-backed and
must not be shared by concurrent server requests. The compiler or server
render API will need a way to supply request-local instances without making
application authors abandon the convenient public APIs.

## Goals

The initial SSR project should provide:

- deterministic HTML for compiled applications;
- server execution without ambient browser globals;
- isolation across concurrent requests;
- output structurally equivalent to client creation mode;
- hydration that adopts existing nodes rather than rebuilding correct output;
- working event handlers and reactive updates after hydration;
- correct list, conditional, route, ref, effect, and cleanup ownership;
- a versioned hydration manifest or equivalent protocol;
- explicit mismatch detection and bounded recovery;
- safe transfer of route and data state;
- a production string renderer validated against the reference renderer.

## Non-goals for the first implementation

- React Server Components or an equivalent split component model;
- partial/island hydration;
- out-of-order streaming;
- suspense-like async scheduling semantics;
- server execution of browser effects;
- serializing arbitrary closures or DOM nodes;
- supporting uncompiled dynamic component graphs;
- guaranteeing byte-identical HTML across unrelated HTML serializers.

Structural and behavioral equality matter more than matching incidental quote
style or attribute order unless the string writer deliberately guarantees a
canonical format.

## Phase 0: freeze list specialization and push invalidation

### Purpose

Finish or stabilize compiler work that changes entity identity, list region
shape, update routing, or external-resource invalidation before hydration
metadata depends on those details.

This phase is a sequencing guard, not an architectural dependency on SSR. If
list specialization or push invalidation can be cleanly isolated from emitted
identity and structure, it should proceed independently rather than delaying
SSR.

### Required outcomes

- Keyed list identity rules are documented and tested.
- **Hydration-safe key encoding contract**: current row identity stringifies
  primitive keys, so `1`, `"1"`, and `1n` can collide in entity ids, strings
  containing protocol-significant characters (`/`, `]`, marker syntax) are
  unsafe, and object/symbol keys receive process-local synthetic ids that
  cannot survive SSR transfer. Phase 0 must deliver type-tagged primitive
  encoding, escaping or opaque encoding for string keys, collision tests over
  these cases, and a declared hydration limitation for object/symbol keys.
  "Stable primitive key" alone is not a sufficient contract.
- Specialized and general list paths expose the same ownership semantics.
- Push invalidation does not alter DOM structure or hydration identity.
- Compiler metadata for rows and structural regions has a stable shape.
- There is a test proving retained keyed rows keep identity across reorder in
  both creation and future hydration modes.

### Exit criterion

No known pending compiler change is expected to invalidate the marker or
manifest identity design. This includes the async/data contract gate below.

### Gate before Phase 2 (async/data semantics)

The data/async layer redesign is a blocking dependency for marker freezing.
`data-colorless-async-rfc.md` section 16 now specifies the proposed answer for
"unresolved resource at flush", exact region fallback entities, runtime-owned
module sources, and source-state serialization/restoration. The design half of
the gate is therefore concrete; implementation evidence and stable emitted
data-site identities are still required before Phase 2's marker protocol work
begins.

## Phase 1: server-safe runtime and LinkeDOM reference renderer

### Purpose

Make synchronous compiled rendering possible on a server without designing a
second renderer immediately. Use LinkeDOM as a semantic oracle and development
tool, not as the final performance tier.

### 1.1 Introduce a request/application runtime context

The kernel's mutable state should become owned by an explicit runtime context:

```ts
interface ApplicationRuntime {
  registry: Map<string, Entity>;
  dirty: Set<string>;
  volatile: Set<string>;
  scheduler: Scheduler;
  effectsEnabled: boolean;
  refsEnabled: boolean;
  dispose(): void;
}
```

The exact public/private shape is open for debate. The important invariant is
that two renders must not share entity, scheduler, effect, or cleanup state.

Browser defaults may continue using one default context. Server entry points
must create and dispose a context per request.

### 1.2 Separate environment capabilities

Code should not infer all behavior from `typeof window`. The render context
should explicitly describe capabilities:

```ts
interface RenderEnvironment {
  mode: 'client-create' | 'server-dom' | 'server-string' | 'hydrate';
  document: DocumentLike;
  schedule?: Scheduler;
  effects: 'run' | 'defer' | 'disabled';
  refs: 'run' | 'defer' | 'disabled';
}
```

Names are illustrative. A capability-based contract is preferable to scattered
browser checks because tests can exercise each tier deterministically.

### 1.3 Resolve module-state isolation

This phase must choose at least a correct reference strategy. Candidate
approaches:

#### Option A: evaluate the compiled application graph once per request

Use an isolated module loader, VM context, or request-specific server bundle.

Advantages:

- preserves ordinary authored module semantics;
- requires fewer compiler changes initially;
- provides a correctness baseline.

Disadvantages:

- module evaluation and memory cost may be high;
- integration with bundlers and module caches is difficult;
- unsuitable as the final high-throughput solution without measurement.

#### Option B: compiler-lift reactive module state into request-owned cells

Rewrite module state access so a binding resolves through the current
application/request instance.

Advantages:

- efficient reuse of compiled module code;
- naturally supports concurrent requests;
- can preserve graph-wide computed and effect routing.

Disadvantages:

- invasive compiler/linker change;
- exported binding semantics and external consumers require care;
- initialization order, cycles, and HMR become more complex.

Important context for Option B: the linker already assigns canonical reactive
identities to module state (for example
`./src/state.ts#store.selectedId`) and uses those identities to connect reads,
writes, computed entities, and invalidation across the module graph. This is
useful metadata for designing request-owned cells, but the underlying authored
bindings still compile to ordinary ESM `let` and `const` storage. Moving that
storage into a request-owned indirection layer would therefore be a new and
significant lowering step built on existing linker knowledge, not an extension
of an already-lifted storage mechanism. The open risks include exported binding
semantics, non-reactive module bindings, initialization order and cycles,
derived/module-effect execution, browser HMR, and interaction with external
module consumers; these must be prototyped explicitly rather than assumed.

#### Option C: require authors to put server state in explicit factories

Advantages:

- simplest implementation.

Disadvantages:

- violates the framework promise that state can live naturally at module
  scope;
- creates separate CSR and SSR authoring models;
- should not be the default design.

#### Option D: route runtime calls with `AsyncLocalStorage`

This helps select a request-local kernel, router, or data runtime. It does not
isolate ordinary ESM variables by itself. It is a supporting mechanism, not a
complete solution.

Recommended debate position: use per-request graph evaluation as the first
correctness oracle if needed, while investigating compiler-lifted module cells
as the likely production architecture. Do not claim request safety until a
parallel test proves module bindings are isolated.

### 1.4 LinkeDOM renderer

Provide an experimental API such as:

```ts
const result = await renderWithDom(App, {
  url: '/projects/compiler?tab=activity',
  document: linkedomDocument,
});

result.html;
result.runtime.dispose();
```

The API name is not normative. The reference renderer should:

- create a fresh document and application runtime;
- install request-local router and data runtimes;
- disable/defer refs and effects;
- invoke the compiled root in server creation mode;
- serialize only the application-owned root nodes;
- dispose all request-owned runtime state after serialization;
- expose diagnostics and optional structural metadata for tests.

### 1.5 CSR-equivalence tests

Compile one authored graph, render it once using browser/client creation and
once using LinkeDOM server creation, and compare normalized DOM structure.

The matrix should include:

- text, attributes, properties, boolean attributes, class, and style;
- HTML and SVG namespaces;
- escaped text and attributes;
- trusted `innerHTML`;
- fragments and multiple root nodes;
- component props and children/render slots;
- empty, text, and element conditional branches;
- keyed, nested, reordered, and empty lists;
- dynamic intrinsic/component candidates;
- route regions, params, query state, and catch-all routes;
- data loading states with injected deterministic fetch;
- confirmation that effects and refs did not execute on the server;
- cleanup after success and failure.

### Phase 1 exit criteria

- Importing server renderer packages does not require `window` or global
  `document`.
- Two simultaneous renders cannot observe each other's component, module,
  router, data, effect, or cleanup state.
- The reference renderer passes the agreed CSR-equivalence matrix.
- Every render disposes its context, including on thrown errors.

## Phase 2: hydration protocol and marker emission

### Purpose

Design the information hydration actually needs, then teach the compiler and
server renderer to emit it. Do not begin with “put `data-m` on everything” and
discover the protocol afterward.

### Marker strategies

#### Dense element markers

Every emitted element receives an identifier such as `data-m`.

Advantages: simple lookup and diagnostics.  
Disadvantages: large HTML overhead, visible DOM pollution, no direct solution
for text, fragments, or empty regions.

#### Boundary-only markers

Only component roots and structural regions receive identity.

Advantages: small output.  
Disadvantages: adoption requires a reliable cursor and careful handling of
ambiguous sibling/text structures.

#### Hybrid markers

Use attributes for meaningful element boundaries and comments for fragments,
text-sensitive insertion points, lists, conditions, routes, and empty regions.

Advantages: covers non-element structures without marking every node.  
Disadvantages: more protocol cases.

Recommended starting point: a hybrid, boundary-oriented protocol. Instrument
every node only in an optional development/debug mode.

### Proposed identity categories

The protocol may need distinct categories for:

- application root;
- stateful component owner;
- keyed list start/end and row identity;
- conditional/route region anchor;
- caller-owned children or render slot;
- dynamic component/host boundary;
- text positions that cannot be reconstructed unambiguously by cursor order.

The exact marker syntax is open. `data-m` is suitable only for elements.
Comments or a compact manifest are needed for other node types.

### Payload structure strawman

Adoption metadata and application state are separate envelopes inside one
transport payload, each independently versioned and validated:

```ts
interface HydrationPayload {
  transportVersion: number;
  rootId: string;
  /** Build-derived adoption metadata. Validated against the client bundle. */
  manifest: {
    protocolVersion: number;
    buildId: string;
    markers: readonly HydrationMarker[];
  };
  /** Application data. Independently versioned; validated on its own terms. */
  state?: {
    formatVersion: number;
    route?: SerializedRouteState;
    data?: SerializedDataState;
  };
}
```

Questions:

- Can structure be reconstructed entirely from deterministic compiler order,
  reducing `markers` to a small set of exceptions?
- Are keyed row keys stored in HTML, manifest data, or both?
- Should manifest/state data be inline JSON, a script payload, or supplied
  directly to `mount(..., { hydration })` by the hosting framework?
- How is the manifest protocol/build ID checked before adoption, and how does
  state's `formatVersion` validation interact with it?

Envelope interaction rule: manifest incompatibility (wrong protocol/build)
forces full client creation but **does not automatically discard state**.
State is retained only when it independently passes its own format, identity,
and compatibility validation for the new build. Old-but-valid state may be
adopted by a new build when its validation passes; anything else is dropped
with a diagnostic rather than trusted silently.

### Marker requirements

- deterministic for the same compiled graph;
- stable across server and client builds of the same version;
- safe under minification;
- collision-free inside one root;
- valid for fragments, empty branches, and multiple roots;
- removable or ignorable after hydration;
- measurable with an explicit HTML byte-overhead budget;
- not based on user-controlled strings without escaping/encoding.

### Phase 2 exit criteria

- A written, versioned hydration protocol exists.
- Marker overhead is measured on small, medium, and list-heavy examples.
- Compiler snapshot tests cover every marker category.
- Server and client builds produce compatible identities.
- The protocol explains text, fragments, empty regions, lists, routes, and
  multiple roots—not only ordinary elements.

## Phase 3: hydration and DOM adoption

### Purpose

Run component initialization to reconstruct closures and runtime entities while
adopting existing server nodes instead of creating equivalent replacements.

### API strawman

```ts
interface RootCreateContext {
  mode: 'create' | 'hydrate';
  host: Element;
  runtime: ApplicationRuntime;
  hydration?: {
    payload: HydrationPayload;
    /** Deterministic per-boundary adoption cursor (see marker strategy). */
    cursor: HydrationCursor;
  };
}

// Single entry point (see decision log). Hydration is a mode, not a second API.
mount('root', App, {
  hydration: { transport: 'auto' },
});

// Element targets without an id cannot use the id-keyed channel lookup and
// must supply the payload explicitly:
mount(hostElement, App, {
  hydration: { payload: parsedFromHostIntegration },
});
```

Element-target rule: automatic channel lookup requires a resolvable root key.
`mount(string, …)` uses the string as the `data-mmd-root` value. An element
target without an `id` has no stable root key, so it **must** receive the
payload explicitly; passing no hydration option to such a mount performs
ordinary client creation. A future opaque root token may relax this, but it is
not part of the initial contract.

The compiler-generated root factory should consume the context:

```ts
registerRootFactory(App, {
  id: 'App',
  create(context) {
    return App('App', null, [], context);
  },
});
```

The ABI is illustrative. The decision to pass context explicitly through every
factory versus selecting it from the application runtime must be benchmarked.

### Adoption responsibilities

Hydration must do more than find the root element:

1. Validate manifest protocol/build identity.
2. Walk server nodes in compiler-defined order.
3. Validate expected node kind, tag, and namespace.
4. Rebuild component closures and local derived state.
5. Seed dynamic value caches from adopted DOM or from freshly evaluated
   expressions.
6. Reconstruct list, condition, route, and children-slot ownership.
7. Register component/computed/effect entities in the request/application
   runtime.
8. Install event handlers without replacing nodes.
9. Install refs after their adopted structural owner is complete.
10. Run initial client effects only after adoption and prop/computed work has
    drained.
11. Remove optional debug-only markers when configured.

### Cache seeding decision

Two approaches need evaluation:

#### Read values from adopted DOM

This avoids rewriting correct values but requires per-property DOM decoding and
can disagree with authored types.

#### Evaluate expressions and seed caches without writing

This preserves authored value semantics. The hydrator compares normalized DOM
state and writes only on mismatch.

Recommended starting point: evaluate authored expressions, normalize them using
the same DOM-value rules as creation mode, compare to adopted state, and seed
the cache. Avoid a blanket update pass that rewrites every attribute/property.

### Lists

Keyed lists are a major hydration contract:

- existing row nodes must be associated with their serialized keys;
- row identities must match client key evaluation;
- duplicate or unserializable keys require a defined diagnostic/fallback;
- row components, effects, refs, and cleanup must attach to the correct owner;
- the first post-hydration reorder must move adopted nodes rather than recreate
  them.

Keys used internally may be arbitrary JavaScript values during CSR. Server
transfer cannot safely serialize arbitrary object identity. The initial SSR
contract may need to require stable primitive hydration keys while retaining
broader CSR behavior. This must be an explicit diagnostic, not silent failure.

### Refs and effects

- Server rendering records ownership but does not invoke ref callbacks.
- Hydration invokes refs after the relevant adopted scope is complete.
- Effects do not run on the server unless a future server-effect API explicitly
  says otherwise.
- Client effects run after hydration render/computed work.
- Hydration failure must tear down any refs/effects already installed during
  the failed attempt.

### Mismatch policy

Hydration mismatches are inevitable in real deployments. The runtime needs a
defined policy.

Recommended levels:

1. Development: report expected/actual node, component/region identity, and
   source metadata where available.
2. Production: remount the smallest safe structural owner.
3. Root fallback: replace the application root only when ownership cannot be
   bounded safely.

Examples:

- Wrong text/attribute with matching structure: correct the value and continue.
- Wrong element tag in a conditional branch: remount that branch.
- Missing keyed row marker: remount the list region.
- Incompatible manifest/build version: skip adoption and perform full client
  creation.

The fallback must drain partially installed refs, events, effects, and entities
before recreating a region.

### Hydration tests

- Adopted root and row node identities are unchanged (`===`).
- No `createElement`/`createTextNode` calls occur for a perfectly matching tree,
  except unavoidable internal anchors if the protocol intentionally omits them.
- Events work immediately after hydration.
- Local, module, derived, prop, list, route, and effect updates work afterward.
- Refs receive adopted nodes exactly once.
- Effects run in the documented order and never ran on the server.
- Conditional/list teardown drains adopted owners correctly.
- A keyed reorder moves the original server nodes.
- Each mismatch category selects the documented recovery boundary.
- Hydrating with a stale build/manifest performs a safe full mount.

### Phase 3 exit criteria

- A matching server tree is adopted without replacing its application nodes.
- All primary reactive and lifecycle features work after hydration.
- Mismatch recovery is bounded, tested, and leak-free.
- Hydration performance and marker overhead are benchmarked.

## Phase 4: string-writer document tier

### Purpose

Replace LinkeDOM on the production SSR path with an allocation-conscious writer
while preserving the exact rendering contract proven by the reference tier.

### Design alternatives

#### Emulate enough of the DOM

Generated code continues calling a `DocumentLike` interface whose nodes write
into a lightweight tree/string representation.

Advantages: maximum generated-code reuse.  
Disadvantages: risks slowly rebuilding a DOM implementation and retaining
unnecessary node allocations.

#### Emit a separate server program

The compiler has distinct DOM and string emission backends.

Advantages: best potential server performance and streaming control.  
Disadvantages: duplicated semantics and a long-term parity burden.

#### Shared abstract document operations

Compiler output calls a small renderer tier for create element/text, set
attribute/property, append, region, and serialization operations. Browser DOM
and string writer implement the tier differently.

Advantages: shared semantics with fewer DOM assumptions.  
Disadvantages: adds calls/abstraction to browser creation unless aggressively
inlined or selected at compile time.

Recommended exploration: define the smallest operation contract based on
measurements from emitted code, then compare a compile-time-selected browser
implementation and server writer. Do not place a generic virtual-node tree
between the compiler and either backend.

### String-writer responsibilities

- correct escaping of text and attribute values;
- boolean, enumerated, and property-backed attribute semantics;
- style object/string serialization;
- HTML versus SVG namespaces;
- void elements;
- deterministic attribute ordering if promised;
- comments and hydration markers;
- trusted `innerHTML` passthrough under the existing unsafe contract;
- fragments and multiple root nodes;
- route-selected output;
- safe incremental buffering;
- byte-oriented output suitable for HTTP responses.

### Reference parity

Every server-render fixture should run through both LinkeDOM and the string
writer. Normalize only serializer details that the public contract declares
irrelevant. Structural differences must be treated as bugs.

### Phase 4 exit criteria

- The writer passes the complete LinkeDOM/CSR parity corpus.
- It requires no browser globals or full DOM package in production.
- It has measured time, allocation, and output-size results.
- Hydration adopts its output using the same manifest/protocol.
- Error cleanup and request isolation remain correct.

## Phase 5: state transfer and production hardening

### Purpose

Prevent duplicate work after hydration and prove the system safe under real
server concurrency, failures, deployment skew, and hostile payloads.

### Data transfer

The normative data-layer design lives in `data-colorless-async-rfc.md`
sections 16.5-16.7. The server transfers source state, not promises, resource
objects, or component closures. Successful, handled-error, and server-pending
sites all need an explicit restored state so the first hydration branch agrees
with the server branch.

Requirements:

- request identity must match client normalization;
- validation results and error policy must be explicit;
- active network handles and `AbortSignal` objects are not serialized;
- private/authenticated responses are included only when the host opts in;
- serialized values are escaped safely against script termination and HTML
  injection;
- hydration does not issue a duplicate request for a restored resource;
- pending work is restored paused and starts only after its hydration owner is
  adopted;
- handled errors restore through a sanitized error record so the same local
  Group Error site is adopted;
- omitted/non-transferable committed state triggers bounded recovery at the
  affected data site instead of trusting mismatched DOM;
- cache scope and retention remain consistent with the data API.

Non-streaming rendering has two explicit modes. `resolve` performs bounded
request-discovery/commit rounds until quiescence and is the production default;
`shell` performs one creation pass and emits Pending/empty sites without
starting server work that will immediately be abandoned. Neither mode keeps an
ambient runtime or document installed across an `await`.

### Router transfer

Transfer the normalized application URL, params, query, matches, and manifest
identity. Do not serialize a live signal or browser history object. The client
router creates a new signal/history boundary and verifies that its initial
resolution agrees with the server.

### Module and local state

Not all state should be serialized.

- Deterministic initial local state can be reconstructed by rerunning component
  initialization during hydration.
- State changed by server data resolution or route selection may require
  transfer or deterministic replay.
- Arbitrary closures, class instances, symbols, weak collections, DOM values,
  and opaque third-party objects need explicit unsupported/adapter behavior.

The proposal should prefer replaying deterministic initialization and
serializing authoritative resource snapshots over attempting to serialize the
entire component closure graph.

### Security requirements

- HTML text/attribute escaping has dedicated adversarial tests.
- Inline JSON/state payloads escape `<`, script terminators, and unsafe Unicode
  separators as required by the embedding form.
- Trusted `innerHTML` remains explicitly unsafe and is never silently sanitized.
- Manifest IDs cannot inject markup or selectors.
- Error messages do not expose secrets from request headers or resource data.
- CSP-compatible external manifest/state delivery is supported or documented.

### Concurrency and failure tests

- Hundreds of parallel renders with different module state, URLs, headers, and
  data results never cross-contaminate.
- Aborted renders dispose data requests, router runtimes, entities, effects,
  refs, and cleanup.
- One thrown component does not poison later requests.
- HMR/development reloads cannot reuse stale hydration manifests.
- Client/server build mismatch takes the documented fallback.
- Repeated hydrate/unmount cycles do not leak registry entries or listeners.

### Phase 5 exit criteria

- No duplicate initial data requests after successful state restoration.
- Parallel request isolation tests pass under load.
- Security and escaping review is complete.
- Build/version skew is handled safely.
- Public SSR/hydration APIs and payload formats are versioned and documented.

## Deferred phase 6: streaming and async coordination

Streaming should follow, not lead, the SSR project. It introduces additional
contracts:

- when route/data work may suspend output;
- how late HTML chunks identify insertion regions;
- how hydration waits for or adopts streamed regions;
- abort propagation from HTTP request to router/data work;
- error boundaries after bytes have already been sent;
- ordering of effects and refs for progressively arriving content;
- cache/state manifest updates after the initial shell.

Synchronous `renderToString` plus reliable hydration should remain the baseline
even after streaming exists.

## Public API strawman

This is a discussion aid, not a naming commitment.

```ts
import { renderToString } from '@memoized-dom/server';
import { mount } from '@memoized-dom/runtime';

const rendered = await renderToString(App, {
  url: request.url,
  fetch: requestFetch,
  signal: request.signal,
});

rendered.html;
rendered.payload; // { manifest, state } — host decides how to deliver it

// Client side. One entry point; hydration is a mode, not a second API.
// The runtime NEVER reads ambient globals such as window.__*.
mount('root', App, {
  hydration: {
    // 'auto': locate the conventional payload channel element rendered
    // inside the host document (see payload delivery below).
    transport: 'auto',
    // Or a host integration supplies the parsed payload explicitly:
    // payload: { manifest, state }
  },
});
```

### Payload delivery contract

The default transport is a **scoped DOM-embedded JSON channel**, not a global
variable:

```html
<script type="application/mmd+json" data-mmd-root="root">
  {"version":1,"buildId":"…","manifest":{…},"state":{…}}
</script>
```

Rationale:

- no `window.__*` namespace pollution and no cross-application collisions;
- parseable with `JSON.parse`, never evaluated as script;
- compatible with nonce-based strict CSP policies that allow inline JSON but
  block inline executable script;
- removable from the DOM after adoption;
- multiple mounted roots cannot fight over shared globals.

Rules:

1. The public runtime API accepts hydration payloads only as explicit
   arguments or through the documented channel-element lookup. It must never
   read ambient globals.
2. Delivery of the payload into the response document is the responsibility
   of the host integration (Vite plugin / server adapter), which owns escaping
   and placement.
3. Manifest and state travel as **separate envelopes** even when embedded in
   one element. Adoption metadata is build-derived and version-checked against
   the client bundle; application state is data with independent
   serializability and security rules. A stale build must not invalidate fresh
   state, and hostile state content must not taint adoption validation.

Questions for the API:

- Should HTML and payload be one response object or independently writable streams?
- Is the server renderer a separate package to keep browser bundles clean?
- How does a host inject request-local router/data services?
- Can the same compiled output serve client create, server DOM, server string, and hydration modes, or should Vite produce environment-specific output?
- Who owns disposal if server rendering throws or the HTTP request aborts?

Resolved by this proposal: there is a single client entry point
(`mount(target, App, options?)`) and hydration is expressed as a mode plus
options, so disposal, root bookkeeping, and error paths have exactly one
implementation.

## Required invariants

Any accepted design must preserve these framework properties:

1. Authored state still uses ordinary TypeScript; SSR must not require hooks or
   signal wrappers.
2. Module-level state must not leak across requests.
3. Hydration does not introduce a virtual DOM or general tree diff.
4. Keyed row identity survives hydration and reorder.
5. Component factories rebuild ownership once; ordinary updates retain their
   generated update closures.
6. Effects run after render/computed work and never accidentally run during
   server HTML generation.
7. Ref setup/teardown follows the same smallest structural owner after
   hydration as after client creation.
8. Router and data state are request-local on the server.
9. Correct server HTML is adopted, not recreated.
10. Mismatches recover at a bounded structural owner when possible.
11. Hydration payloads reach the runtime only through explicit arguments or the
    documented scoped channel element; the public API never reads ambient
    globals such as `window.__*`. Automatic channel lookup requires a
    resolvable root key: element targets without an id must receive the
    payload explicitly.
12. Manifest/adoption metadata and application state are validated as separate
    envelopes. Manifest incompatibility does not automatically invalidate
    state; state is retained only when it independently passes its own format,
    identity, and compatibility validation, and is otherwise dropped with a
    diagnostic. State content never taints adoption validation.

## Decision log template

Agents debating this proposal should record decisions in this form:

```text
Decision:
Status: proposed | accepted | rejected | deferred
Problem:
Options considered:
Chosen option:
Evidence or prototype:
Performance/size impact:
Compatibility impact:
Open follow-ups:
```

Claims about performance should include a benchmark or emitted-output
measurement. Claims about correctness should include a compiler/runtime test or
a concrete counterexample.

## Decision log

Decisions recorded during the 2026-08 design review of this proposal.

```text
Decision: Two-tier server rendering — LinkeDOM reference tier first, purpose-built string-writer production tier second.
Status: accepted
Problem: Server rendering must be provably correct before it is fast.
Options considered: LinkeDOM only; string writer only; both tiers in parallel.
Chosen option: LinkeDOM as correctness oracle and dev tool; string-writer tier added only after the parity corpus passes.
Evidence or prototype: Writer parity probe (see Recommended immediate prototypes).
Performance/size impact: String tier expected to be the throughput path; measured in Phase 4 exit criteria.
Compatibility impact: Both tiers must produce structurally identical output per the parity rules.
Open follow-ups: Exact operation contract for the writer, derived from emitted-code measurements.

Decision: Hydration is ID-addressed structural boundary adoption with deterministic local cursors — no virtual tree reconstruction, no global diffing; node creation occurs only on mismatch recovery.
Status: accepted
Problem: Traditional hydration re-renders and diffs against server HTML.
Options considered: Global traversal-cursor adoption (Solid-style); dense markers enabling truly cursor-free adoption; sparse id-addressed boundaries.
Chosen option: Compiler-canonical hierarchical ids embedded as sparse hybrid boundary markers (dense markers in development builds only). Sparse boundary ids cannot directly address unmarked text and static children, so adoption inside each located boundary proceeds with a deterministic local cursor driven by compiler-defined order. "Cursor-free" would require substantially denser markers and is explicitly not the chosen trade-off. On a perfectly matching hydration path no nodes are created or replaced; mismatch recovery creates replacement nodes only at its documented remount boundary.
Evidence or prototype: Sparse adoption probe must confirm that boundary-id location plus local-cursor adoption handles text, conditionals, and keyed lists without ambiguity.
Performance/size impact: HTML overhead budget to be measured in Phase 2 with a concrete numeric target set then.
Compatibility impact: Marker/manifest identity depends on Phase 0 stability guard.

Decision: Single client entry point — mount(target, App, options?) with hydration expressed as mode + options; no separate hydrate() API.
Status: accepted
Problem: Two entry points duplicate disposal, root bookkeeping, and error paths forever.
Options considered: Separate hydrate(); mount mode flag.
Chosen option: mount mode flag.
Evidence or prototype: None required — API-shape decision.
Performance/size impact: Negligible.
Compatibility impact: One public lifecycle contract to document and test.

Decision: Payload delivery never uses ambient globals. Runtime accepts payloads as explicit arguments or via the documented scoped JSON channel element; manifest and state travel as separately validated envelopes.
Status: accepted
Problem: window.__* globals are namespace-polluting, CSP-hostile, untestable, and collide across applications.
Options considered: window globals; one merged global payload; scoped DOM-embedded JSON channel per root; explicit argument injection.
Chosen option: Scoped <script type="application/mmd+json" data-mmd-root="..."> channel plus explicit-argument injection; host integration owns delivery and escaping; runtime removes the element after adoption.
Evidence or prototype: None required — security/API decision grounded in CSP behavior.
Performance/size impact: Payload bytes counted against the Phase 2 overhead budget.
Compatibility impact: Recorded as invariant: the public runtime API must not read ambient globals.

Decision: Module-state isolation targets compiler-lifted request-owned cells (Option B) as the production architecture; per-request graph evaluation is a correctness oracle only.
Status: accepted (direction), pending isolation-probe prototype
Problem: ESM module state is singleton across concurrent requests.
Options considered: Per-request evaluation; compiler-lifted cells; author-managed factories; AsyncLocalStorage alone.
Chosen option: Option B direction. The linker's existing canonical state identities (for example ./src/state.ts#store.selectedId) provide the addressing and invalidation foundation — covering mutable bindings, mutated const contents, derived chains, and module effects regardless of declaration keyword. However, the underlying values remain ordinary ESM storage today; moving binding storage into request-owned cells is a new compiler/runtime lowering built on that foundation, not existing behavior.
Evidence or prototype: Isolation probe must prove no cross-request reads before any safety claim.
Performance/size impact: Avoids per-request module evaluation cost at steady state.
Compatibility impact: Open risks retain the full list: exported live-binding semantics for external consumers, import cycles, initialization order, module effects, HMR interaction, and non-reactive/unlinked state.

Decision: Mismatch recovery ladder fixed — development diagnostics, smallest safe structural owner remount, root fallback last.
Status: accepted
Problem: Server/client disagreement needs bounded, predictable handling.
Options considered: Always full remount; per-category remount ladder.
Chosen option: Per-category remount ladder with mandatory drain of partially installed refs/events/effects/entities before recreation.
Evidence or prototype: Hydration tests enumerate every mismatch category.
Performance/size impact: Bounded work per mismatch.
Compatibility impact: Fallback boundaries become public, documented behavior.

Decision: Phase ordering frozen (0–6) with streaming deliberately last.
Status: accepted
Problem: Streaming before reliable synchronous SSR/hydration compounds unknowns.
Options considered: Streaming early; streaming last.
Chosen option: Streaming last; synchronous renderToString + adoption remains the permanent baseline even after phase 6.
Evidence or prototype: N/A — sequencing decision.
Performance/size impact: N/A.
Compatibility impact: Phase 0 guard protects marker/manifest identity from concurrent compiler changes.

Decision: The data/async layer redesign (transparent async reads, region-provided fallbacks, push invalidation, resource serialization rules) is a blocking dependency for Phase 2 marker freeze.
Status: accepted sequencing constraint; design specified, implementation evidence pending
Problem: Marker identities cannot stabilize until async output and exact data-site ownership are defined.
Options considered: Freeze markers now; gate marker freeze on agreed async semantics.
Chosen option: Gate. Push invalidation stays in the data/compiler work; source-state serialization and restore-before-create are specified in `data-colorless-async-rfc.md` section 16.
Evidence or prototype: Local Group/derived/list/cross-component behavior exists; projection transport, exact data-site entities, runtime-owned module descriptions, and snapshot restoration still need their listed implementation slices.
Performance/size impact: N/A.
Compatibility impact: Prevents premature protocol churn.
```

## Questions for agent debate

### Request isolation

1. What is the first correct implementation of per-request module binding
   isolation?
2. Is per-request module evaluation acceptable as a reference tier?
3. Can compiler-lifted module cells preserve ESM imports, cycles, derived
   chains, module effects, and HMR without changing authored semantics?
4. Which runtime globals become fields on an application context?

### Rendering tier

5. Should generated output access an injected `document`, an abstract renderer,
   or environment-specific compiler helpers?
6. What exact role does LinkeDOM play in production versus testing?
7. What DOM semantics are difficult to represent faithfully in a string writer?

### Markers and manifest

8. What is the minimum identity needed to adopt deterministic compiler output?
9. Where are attributes preferable to comments?
10. Can keyed row identity be reconstructed without serializing every key?
11. What HTML-size budget is acceptable for hydration metadata?
12. Should debug builds emit dense markers while production uses sparse ones?

### Hydration behavior

13. How are dynamic slot caches seeded without redundant DOM writes?
14. What is the smallest safe remount boundary for each mismatch category?
15. When exactly do refs and effects activate?
16. How are nested route/list/conditional owners rebuilt from one cursor?
17. What happens when server and client evaluate a nondeterministic initializer
    differently?

### State transfer

18. Which `$fetch` snapshots are safe and useful to serialize?
19. How are custom validators, class instances, dates, maps, sets, bigint, and
    cyclic values handled?
20. Does the hydration manifest own application state, or should state use a
    separate host-defined channel?

### Packaging and build

21. Should SSR live in `@memoized-dom/server`?
22. Does Vite emit separate client/server graphs and build IDs?
23. How are server-only dependencies excluded from browser bundles?
24. How are protocol compatibility and stale deployments detected?

## Recommended immediate prototypes

Before committing to the full design, build four narrow prototypes:

1. **Isolation probe:** render the same graph concurrently with different
   module-level primitive/object state and prove no cross-request reads.
2. **Reference renderer:** compile one representative application, render with
   LinkeDOM, and compare normalized output with client creation.
3. **Sparse adoption probe:** hydrate a component containing text, one
   conditional, and one keyed list using only boundary markers plus
   deterministic local cursors; measure whether adoption proceeds without
   ambiguity.
4. **Writer parity probe:** implement the minimum element/text/attribute writer
   for that same fixture and compare it with LinkeDOM output.

These prototypes target the highest-risk assumptions. They should be completed
before broad compiler marker emission or public API work.

## Proposed success criteria

SSR/hydration is ready for an initial public release when:

- server rendering is request-isolated and browser-global-free;
- the string writer matches the reference renderer across the semantic corpus;
- matching HTML hydrates without replacing application nodes;
- events, state, derived values, conditions, lists, routes, refs, effects, and
  cleanup work after adoption;
- server effects/refs do not run accidentally;
- initial route/data state transfers without duplicate work;
- mismatch recovery and build skew are safe;
- output size, render time, hydration time, and allocation benchmarks are
  published;
- the limitations around serializable keys/state and unsupported opaque values
  are explicit.

Until those conditions hold, LinkeDOM SSR and hydration should be labeled
experimental. The production string writer should not be treated as correct
merely because it produces plausible HTML; it must remain locked to the
reference and hydration test suites.
