# Review — Colorless Async RFC open findings

Status: awaiting design feedback
Subject: `data-colorless-async-rfc.md` (transparent data values + local Groups)
Reviewer: ox-alpha (architecture pass over the 2025 draft expansion)
Purpose: handoff document. Each finding states the problem, why it matters,
options considered, and a recommendation. Decisions recorded here should be
folded back into the RFC's decision log.

---

## Finding 1 — R2 ("imperative reads throw") has no enforcement mechanism

### Problem

§2.3-style rule R2 says an out-of-scope imperative read of an unresolved
source throws:

```tsx
<button onClick={() => save(user.id)}>Save</button>  // user unsettled → throw
```

But the RFC **rejects proxies** (correctly — they break types, hide read
tracking, cost performance), and no other mechanism is specified. Without one,
the binding holds an internal cell/holder object at runtime, and an
uncompiled read silently hands that holder into application code. No throw —
just invisible corruption (`user.id` is `undefined`, typed as `string`).

### Why it matters

R2 is the honesty contract that makes colorless typing acceptable. If it is
unenforceable, every handler read of fetched data is a silent landmine.

### Suggested resolution

**Compiler-instrumented imperative reads.** The compiler owns the whole
module, so it can classify every read of a source binding:

- JSX slot sites / derived chains / attribute sinks → direct cell reads
  (existing lowering);
- everything else (handlers, effects, module-level statements) → wrap the
  read in a runtime guard call, e.g. `_MD.readSource(user)`.

The guard returns the committed value or throws a diagnostic naming the
binding and the nearest enclosing scope. Cost: one function call per
imperative read — negligible, and only on bindings the compiler has
classified as transparent sources.

### Follow-up work if accepted

- add to §8 (compiler contract) as an explicit item: "instrument all
  non-slot reads of source bindings with the resolution guard";
- define the diagnostic text contract;
- decide whether settled-guarded reads (after `$track(x).settled` check in
  the same scope) compile to unguarded reads — an optimization, not required
  for v1.

---

## Finding 2 — module-scope sources vs server request isolation

### Problem

§6 promises module-scope sources work:

```tsx
// session.ts
export const currentUser = $fetch<User>('/api/session');
```

But ESM evaluates a module once per process. Executed literally, the fetch
fires once globally and every server request shares one response — exactly
the singleton leak slices 1.1–1.7 of the SSR work exist to prevent. §6
asserts request-locality but §13 (implementation sequence) has no step that
delivers it.

### Owner direction (recorded)

The planned mechanism is **reactive query/parameter values**, with two
properties made explicit by the owner:

1. **Derived re-execution**: a reactive query is a derived computation — when
   any of its dependencies change, the source re-runs automatically.
   Dependency change ⇒ new request; no dependency change ⇒ no request.
2. **SWR during re-execution**: while the source re-runs, the previously
   committed value stays visible at every consumption site. The re-run
   replaces it only on success. This is the same stale-while-revalidate
   behavior §4.2 of the RFC defines for manual refresh — reactive queries
   inherit it rather than inventing a second rule.

That is the right long-term shape and matches §4.18's note that input
reactivity extends the options surface, not the URL.

### Remaining questions even with derived reactive queries

Reactive re-execution answers "how does a source update", not "whose copy is
it". Still open:

1. **First execution timing at module scope.** A module-scope source cannot
   start fetching during process boot on the server. It must instantiate
   lazily per consuming request. This looks exactly like the SSR state-cell
   lifting (slice 1.7): authored module-scope bindings lower into
   request-owned instances keyed by canonical identity. Recommendation:
   unify transparent sources with the existing cell machinery rather than
   inventing a second lifting pass.
2. **Identity across requests.** With derived re-execution, request identity
   is a function of the resolved query dependencies: two concurrent requests
   with different dependency values are different sources with separate
   committed values. Identity semantics need definition against the store
   (already flagged as its own RFC).
3. **Client-side module-scope sources** keep today's behavior (one process,
   one browser, one user) — no lifting needed there. The split should be
   explicit: lifting exists *for the server tier*.
4. **Interaction with `transfer`.** Server-authoritative snapshots restore
   into a per-request instance before root creation; the module-scope binding
   must resolve to that instance during hydration rendering. Same mechanism
   as (1).
5. **Dependency tracking boundary.** Derived re-execution needs the compiler
   to know which reads inside the query expression are tracked inputs. This
   composes with the colorless compiler contract (§8) but must be listed as
   its own responsibility: classify query-expression reads as derivation
   inputs, not as ordinary consumption sites (a query read never shows
   pending DOM).

### Recommendation

Add an explicit §13 step: "request-owned instantiation of module-scope
sources, built on the state-cell lifting"; record reactive-query identity as
the separate store-level RFC it already is.

---

## Finding 3 — pending DOM insertion has an HTML-legality constraint

### Problem

Per-site pending inserts fallback DOM at the exact consumption site:

```tsx
<h1>{user.name}</h1>
```

with `<Pending component={() => <div class="bar" />} />` means injecting a
`<div>` inside `<h1>`. HTML parsers reparse invalid nesting during template
cloning — the DOM you adopt is not the DOM you authored, and hydration
adoption inherits the corruption. Additionally, a bare text-node slot cannot
host sibling elements, so managed sites inside a Group need anchor pairs
(comment anchors) around them — a small per-site DOM/emission cost that
should be stated, not discovered.

### Options

1. **Convention**: inline-site pending components must render phrasing
   content (spans, images, text); document it; no enforcement.
2. **Compiler warning**: emit a diagnostic when a pending component's root
   element tag is flow content inserted into a phrasing context (the
   compiler knows the parent element of each site).
3. **Structural override syntax** (already RFC open question 2): when the
   author wants block-level skeleton UI, they mark the *element* as the site
   instead of the text slot.

### Recommendation

Ship option 1 for v1, add option 2 as a lint-level diagnostic (cheap once
site→parent mapping exists for anchors anyway), keep option 3 open. Document
anchor-pair emission under §8 compiler responsibilities.

---

## Finding 4 — "exactly three children" forbids omitting unused arms

### Problem

§3 mandates Group has exactly three children in order. But many groups will
never fail (a stats endpoint with no failure UX) or never need a pending arm
(data expected from cache). Forcing boilerplate arms is DX friction and
produces dead components.

### Suggested rule

At most `Pending`, at most `Error`, at most one content child, in that
order. Omitted-arm behavior falls out of existing rows:

- omitted `Pending` → unavailable sites render empty (same as §3.11);
- omitted `Error` → initial failure takes the "loud framework error" row of
  §10.

This keeps the normalized shape (no ambiguity about which child is content)
while removing forced boilerplate. The strict three-child reading can remain
as the documented common case.

---

## Finding 5 — "loud framework error" is undefined, and SSR makes it dangerous

### Problem

§10 says an initial failure with no Group is a "loud framework error". The
mechanism is unspecified, and the stakes differ by tier:

- **client**: an uncaught throw during a commit kills that drain;
- **server**: an uncaught throw during flush kills the entire HTTP response —
  one optional widget failing nukes the page for everyone.

### Options

1. Throw everywhere (dev + prod). Honest; prod pages can die.
2. Dev throws; prod logs a diagnostic and renders the empty-site behavior.
   Less honest, far more survivable.
3. Dev throws; prod throws too, but the SSR layer catches per-root and emits
   a 500-with-partial policy decision for hosts.

### Recommendation

Option 2 for v1 (matching how most frameworks degrade), with the thrown dev
diagnostic carrying the same message. Revisit option 3 when the host/error-
boundary integration is designed. Whatever lands, §10 needs the mechanism
named — "loud" is not a spec.

---

## Finding 6 — capability/payload member collisions have a cheap partial answer

### Problem (RFC open question 7)

`ResolvedValue<T> = T & ResolvedOperations<T>` collides when a payload type
declares `refresh`, `update`, `remove`, `append`, … The payload field becomes
unreachable because the compiler redirects recognized calls to the resource.

### Suggested answer (partial)

The compiler knows `T`. When it resolves the operation surface for a source
binding, it can emit a **compile-time diagnostic** whenever `T` declares a
member that collides with the operation surface — forcing disambiguation at
the exact offending call site (e.g. via a namespaced escape hatch like
`$ops(users).refresh()` reserved for collisions). This avoids shipping a
prefixed API for everyone while making collisions impossible to hit silently.
Full namespacing remains available if real-world payloads collide often.

---

## Minor notes (no action required beyond awareness)

- §3.9 conditional-region pending composes cleanly with the frozen marker
  work from slices 1.5–1.9: a region showing pending-policy content is just
  another region state. Worth stating explicitly in §12 so nobody assumes SSR
  markers must restart.
- §3.7 derived chains correctly reuse the shipped replaying-derivation
  behavior — no new machinery needed there.
- §10's table is the single most useful artifact in the RFC; consider moving
  it earlier (it doubles as the test-oracle matrix for implementation phase
  fixtures).
- Naming remains open (`Group` reads fine now that it is a policy scope, not
  a gate; `$track` still feels provisional).

---

## Response template

```text
Finding N: accepted | accepted with changes | rejected | deferred
Notes:
```
