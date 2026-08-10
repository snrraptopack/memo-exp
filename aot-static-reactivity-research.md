# Static Reactive Linking for Plain TypeScript and JSX

## Research positioning, formal model, and paper-writing guide

This document is the research companion to `paper-draf.tex`. It distinguishes
what `memoized-dom` currently implements from broader claims that would require
proof or evaluation, and it positions the work against the closest academic and
industrial precedents.

The central correction is important:

> Compile-time dependency analysis and generated incremental update code are
> not, by themselves, novel. IceDust and PixieDust are direct academic
> precedents, Lustre is a foundational static-dataflow precedent, Incremental
> Lambda Calculus is a broad static-transformation precedent, and Svelte 3/4 is
> an important industrial precedent.

The paper should therefore describe the contribution as **static reactive
linking for ordinary TypeScript/JSX modules**, not as the invention of static
reactivity.

---

## 1. The strongest defensible research claim

`memoized-dom` explores whether a useful subset of ordinary, mutable
TypeScript/JSX applications can be compiled into fine-grained DOM updates
without discovering source-to-consumer dependencies while the application is
running.

The distinctive combination is:

1. Authored state is made from ordinary lexical bindings and mutable object
   properties rather than required signal, store, hook, or decorator APIs.
2. Read effects, write effects, and parameter-relative effects are inferred
   with binding-aware, interprocedural analysis.
3. A fixed-point linker propagates those effects through named ES-module
   imports and helper chains.
4. Module-qualified access paths give the same binding one canonical reactive
   identity in every importing file.
5. Compiler-generated table fragments route writes to exact or structural live
   UI entities without read-time subscription discovery.
6. Conservative fallbacks preserve coverage when an effect can be bounded only
   to a receiver/root, or cannot be bounded at all.

A safe one-sentence formulation is:

> We present a whole-application compiler and runtime for a statically
> analyzable subset of TypeScript/JSX that links module-qualified read/write
> effects across ES-module boundaries and routes mutations to live structural
> UI instances without runtime read tracking.

Avoid priority words such as “first” until a systematic literature review has
tested that claim. “We present,” “we investigate,” and “the distinguishing
combination in our design” are academically safer.

---

## 2. What the implementation actually does

### 2.1 Module state remains ordinary JavaScript state

The compiler recognizes module-owned `let`/`var` bindings and mutable
`const` objects/arrays. A state location is identified by its defining module,
root binding, and optional static member path:

```text
./src/state.ts#count
./src/state.ts#store.selectedId
./src/state.ts#store.todos
```

Two files may both export `count`; their canonical identities do not collide.
The identity follows Babel binding resolution inside a module and linker import
resolution across modules.

### 2.2 Cross-file reads retain defining-module identity

```tsx
// state.ts
export const store = { selectedId: null as number | null };

// Row.tsx
import { store } from './state';

export function Row({ item }) {
  return <button class={store.selectedId === item.id ? 'active' : ''} />;
}
```

The read in `Row.tsx` is serialized as
`./state.ts#store.selectedId`, not `./Row.tsx#store` and not the local import
name. Import aliases therefore do not change reactive identity.

### 2.3 Cross-file writes take two legal ES-module forms

An imported binding cannot be reassigned. Cross-file mutation therefore
appears primarily as either a property mutation or an exported mutator call.

```ts
// Property mutation in an importing module
import { store } from './state';
store.selectedId = id;

// Mutator hidden in the defining module
// state.ts
export let selectedId = null;
export function select(id) { selectedId = id; }

// controls.ts
import { select } from './state';
export function choose(id) { select(id); }
```

For the second form, the linker propagates a summary for `select` through the
call to `choose`. The caller can emit a commit for the canonical key even
though the assignment occurs in a different file.

### 2.4 Linked summaries are richer than a call-graph edge

An exported function summary contains:

```text
S(f) = <reads, exactWrites, boundedWrites,
        parameterRelativeWrites, unbounded>
```

The fixed-point worklist reanalyzes importers when an export summary changes.
This supports imported helper chains and parameter-relative receiver effects.
Unresolved external calls are conservatively unbounded.

### 2.5 Modules contribute fragments to one application dependency index

Each compiled file emits a fragment mapping canonical state paths to structural
entity patterns. At module initialization, fragments are merged by the runtime:

```text
canonical state path -> exact entity IDs and wildcard entity patterns
```

A write in module A can therefore select an entity whose factory was declared
in module B and whose runtime placement was derived from a caller in module C.

This is a compiler-generated runtime dependency **index**. It is not accurate
to say there is no runtime dependency representation at all. What is absent is
runtime discovery and maintenance of source-to-consumer edges caused by reading
reactive values.

### 2.6 Module-derived values and module effects are linked singleton entities

The implementation also covers program state that the earlier research note
omitted:

- Pure module-level expression derivations are emitted as singleton computed
  entities.
- Exhaustive module-level `if`/`switch` assignments can be emitted as
  singleton control-flow derivations.
- Their imported inputs and exported outputs retain canonical identities.
- Direct module effects are singleton effect entities whose imported reads are
  routed through the same index.
- A changed derived value commits its own canonical target only after a value
  guard observes a change.

Thus a chain may cross multiple files:

```text
state.ts write
  -> derived.ts singleton computation
  -> exported derived binding
  -> view.tsx component or module effect
```

---

## 3. A module-aware formal model

### 3.1 Domains

Let a linked application be:

\[
\mathcal{A} = \langle M, K, C, F, P, R, W, AT, L \rangle
\]

where:

- \(M\) is the finite set of modules in the connected compilation graph.
- \(K\) is the set of canonical reactive locations.
- \(C\) is the set of compiled computations: DOM update closures, structural
  regions, module computeds, and effects.
- \(F\) is the set of analyzed functions with interprocedural summaries.
- \(P\) is the set of structural entity patterns.
- \(R(c) \subseteq K\) is the static read over-approximation of computation
  \(c\).
- \(W(f) \subseteq K\) is the exact or bounded write over-approximation of
  function/scope \(f\).
- \(AT : K \to \mathcal{P}(P)\) is the inverted access table.
- \(L\) is the runtime set of live entity instances.

### 3.2 Canonical reactive locations

Define:

\[
\operatorname{key}(m,b,\pi) = \operatorname{moduleId}(m) \# b [.\pi]
\]

where \(m \in M\), \(b\) is a binding declared in \(m\), and \(\pi\) is a
possibly empty static property path. Import resolution is an identity-preserving
map:

\[
\operatorname{resolve}(m_i, a) = \operatorname{key}(m_d,b,\epsilon)
\]

for local import alias \(a\) in importer \(m_i\), defining module \(m_d\), and
exported binding \(b\).

This explicitly models the cross-file property missing from the previous
formalization.

### 3.3 Interprocedural summary linking

For each analyzable function \(f\), define:

\[
S(f) = \langle R_f, W_f, B_f, Q_f, U_f \rangle
\]

where \(B_f\) contains receiver/root-bounded effects, \(Q_f\) contains effects
relative to formal parameters, and \(U_f\) records an unbounded effect.

At a call site \(g(e_1,\dots,e_n)\), linked summaries are instantiated by
substituting each parameter-relative path with the canonical origin of the
corresponding argument when that origin is statically known. Summary inference
is a monotone fixed point over the module import graph. The paper should state
the finite abstract domain and termination argument explicitly before claiming
a formal linker theorem.

### 3.4 Access-table synthesis

For each computation \(c\), the compiler derives one or more structural
patterns \(\operatorname{pat}(c)\). Then:

\[
AT(k) = \bigcup_{c : k \in R(c)} \operatorname{pat}(c)
\]

Patterns include exact singleton IDs, keyed-row wildcards, and bounded
descendant patterns. The current runtime also treats static state member paths
with ancestor/descendant prefix matching: writing a root invalidates readers of
its known members, and writing a member invalidates readers of its root.

### 3.5 Runtime resolution

For committed writes \(W_\sigma\), define:

\[
D_\sigma = \{\ell \in L \mid
  \exists k \in W_\sigma, p \in AT(k) : p \sim \operatorname{id}(\ell)\}
\]

The runtime marks \(D_\sigma\) dirty, deduplicates it, and executes ordinary
render/computed entities before effects, with shallower entities before deeper
ones. Wildcard matches are maintained incrementally as entities mount and
unmount. This is runtime maintenance of pattern-to-live-instance expansions,
but it is not read-triggered dependency discovery.

### 3.6 Conditional completeness statement

A useful theorem can be stated only under explicit assumptions:

1. **Read coverage:** every reactive read that may influence \(c\) is included
   in \(R(c)\).
2. **Write coverage:** every relevant mutation executed by \(\sigma\) is
   included in \(W_\sigma\), or selects the unbounded fallback.
3. **Summary soundness:** linked function summaries over-approximate the effects
   of their implementations after argument substitution.
4. **Instrumentation coverage:** each completed mutation scope executes its
   generated commit at the semantically required boundary.
5. **Pattern/instance consistency:** every live instance of \(c\) matches a
   pattern emitted for \(c\).
6. **Closed linked graph:** all imports relied upon for precise analysis resolve
   to the versions whose summaries were compiled.

Under these assumptions, a computation that reads a location written by the
scope is included in the selected dirty set. This is a conditional compiler
correctness result, not yet a proof that the full TypeScript/JavaScript analysis
meets every assumption.

Exception exits, opaque future callbacks, reflection, `eval`, dynamic
`Function`, unresolved packages, and native/third-party mutation are therefore
not small details: they define the soundness boundary.

---

## 4. What prior work already establishes

### 4.1 Lustre (Proceedings of the IEEE, 1991)

Lustre is a synchronous dataflow language for reactive control and monitoring
systems. Equations describe streams; the compiler checks clocks and compiles
the declarative network to bounded-memory sequential/automaton code.

**Already established:** statically structured reactive/dataflow programs can
be scheduled and compiled into efficient sequential reactions.

**Difference:** Lustre is a synchronous stream language with explicit equations
and clocks, not an analysis of mutable ES-module state or DOM instance
lifecycles. It is foundational precedent for static scheduling, not the closest
UI comparison.

### 4.2 Incremental Lambda Calculus (PLDI 2014)

Cai et al. transform a pure higher-order program \(f\) into a derivative that
maps input changes to output changes. The transformation is fully static,
automatic, requires no special runtime graph, and has a machine-checked Agda
correctness development for the calculus.

**Already established:** static program transformation can generate
incremental programs without runtime tracing.

**Difference:** ILC computes output deltas for pure lambda terms and requires
change structures/derivatives for primitives. `memoized-dom` instead attributes
imperative writes to affected UI computations and usually re-evaluates guarded
expressions; it does not derive a general mathematical delta program. ILC is a
broad theoretical precedent, not an implementation-equivalent system.

### 4.3 IceDust (ECOOP 2016)

IceDust is the closest formal-analysis ancestor. Its DSL describes derived
attributes in persistent object graphs. A path-based abstract interpretation:

1. extracts dependency paths,
2. inverts them into a dataflow relation, and
3. constructs a graph, strongly connected components, and a topological order.

It generates Calculate-on-Read, Calculate-on-Change, or
Calculate-Eventually strategies.

**Already established:** path extraction, dependency inversion, generated
incremental maintenance, cycles/SCCs, and topological ordering.

**Difference:** IceDust analyzes a restricted declarative data-model DSL whose
derived values are read-only during calculation. It does not address JSX DOM
entities, ordinary imperative TypeScript mutation scopes, ES-module alias
resolution, component placement, or module-owned effects.

### 4.4 PixieDust (WWW 2018)

PixieDust extends the IceDust analysis with functions and views. It statically
over-approximates model/view dependencies, inverts them, updates browser UI,
and automatically derives collection identities. Its implementation targets
React and reports performance comparable with MobX in its evaluation.

PixieDust is very close and must be discussed prominently, not buried under a
generic “incremental computation” paragraph.

**Already established:** compile-time static dependency tracking for
incremental browser-DOM UI, path substitution through functions, structural
collections, and conservative re-rendering.

**Important runtime distinction:** PixieDust's semantics stores subscribed
components per field, a component store, a re-render queue, cached virtual DOM,
and dirty flags. Thus static analysis does not imply the absence of runtime
subscription structures.

**Difference:** PixieDust uses a purpose-built model/view/action DSL with
explicit entities and inverse relationships and renders through React/virtual
DOM. `memoized-dom` targets ordinary TypeScript/JSX, infers imperative writes,
links identities and function effects across ES modules, and emits direct DOM
update closures plus a compiler-generated structural access index.

### 4.5 Reactive variables (Modularity Companion 2016)

Schuster and Flanagan add reactive variables to an imperative language. Their
lexical restrictions make the dependency graph topologically ordered and
acyclic, and their JavaScript prototype uses Sweet.js.

**Already established:** imperative-looking variables can hide signal-like
machinery and lexical restrictions can make ordering statically tractable.

**Difference:** reactive variables are explicit language extensions and the
work does not focus on DOM compilation or cross-module structural instance
routing.

### 4.6 Svelte 3/4 legacy reactivity

Legacy Svelte is the most important industrial precedent. The compiler
instruments ordinary assignments (`count += 1` becomes an invalidation) and
determines dependencies of `$:` statements at compile time. Reactive statements
are topologically ordered. Svelte's own documentation also records the
limitation: dependencies hidden behind a function call are not visible to that
analysis.

**Already established:** plain local variables, compiler-instrumented writes,
compile-time reactive dependencies, topological ordering, and direct DOM
updates in a production UI compiler.

**Difference:** legacy static reactivity is primarily component-local; shared
cross-file state normally uses stores and their runtime subscription contract.
The `memoized-dom` linker attempts interprocedural, module-qualified routing for
ordinary imported state and imported mutators. This comparison should be
evaluated directly with examples, not asserted only in prose.

### 4.7 Svelte 5, Solid, and Vue

These systems primarily discover fine-grained dependencies during execution:

- Solid registers the current observer when a signal getter runs.
- Vue tracks Proxy/ref reads in a `WeakMap<target, Map<key, Set<effect>>>` and
  triggers stored effects on writes.
- Svelte 5 `$derived` and `$effect` determine dependencies when evaluated and
  are implemented with signals under the hood.

Their advantage is path-sensitive precision and refactorability: a dependency
behind an arbitrary function call is observed if it is actually read. Their
cost is runtime dependency storage and maintenance. Static linking has the
opposite trade-off: a conservative closed-world approximation and fallback
surface in exchange for removing read-time tracking.

### 4.8 Reactive Programming on the Bare Metal (REBLS 2022)

Oeyen et al. formalize Remus, a low-level VM influenced by Haai. Reactor graphs
are textual descriptions that can be topologically pre-scheduled ahead of
time, avoiding a dynamically maintained priority queue, while special commands
support dynamic deployments and branching.

**Already established:** AOT topological scheduling can bound scheduling
overhead, and static reactor descriptions can coexist with controlled dynamic
graph structure.

**Difference:** Remus assumes an explicit reactor/dataflow language and focuses
on glitch freedom and constrained embedded hardware. `memoized-dom` infers
effects from imperative TypeScript/JSX and focuses on routing state writes to
DOM/component/effect instances.

---

## 5. Comparison matrix

| Work | Source model | Dependency determination | Cross-unit story | Runtime dependency representation | Main update target |
|---|---|---|---|---|---|
| Lustre | Synchronous equations/streams | Static | Nodes/modules in dataflow language | Compiled sequential/automaton state | Reactive streams/control |
| Incremental \(\lambda\)-Calculus | Pure typed lambda terms | Static differentiation | Higher-order composition | No dependency graph required by transformation | Output deltas |
| IceDust | Declarative object-graph DSL | Static path interpretation and inversion | Whole data model | Strategy-specific caches/scheduling | Derived attributes |
| PixieDust | Model/view/action UI DSL | Static path analysis | Functions and entity/view definitions | Field subscriptions, component store, queue, VDOM cache | React-rendered views |
| Reactive variables | Imperative language extension | Lexically constrained/static order | Lexical scope restriction | Reactive-variable implementation | Reactive variables |
| Svelte 3/4 | `.svelte` components | Static for assignments and `$:` | Stores for shared external state | Dirty state/update scheduler; stores subscribe at runtime | Direct DOM updates |
| Solid / Svelte 5 / Vue | Signals, refs, proxies, runes | Dynamic read tracking | Naturally crosses functions/modules through reactive values | Runtime source-observer graph/maps | Fine-grained effects/DOM |
| Remus/Haai | Explicit reactors | Static pre-scheduling plus dynamic deployments | Reactor composition | Deployment/VM state | Signal propagation |
| `memoized-dom` | Plain TS/JSX subset | Static binding/path/effect analysis | Fixed-point ES-module linking and canonical paths | Static index, wildcard expansions, live entity registry, dirty queue | Direct DOM/component/effect closures |

---

## 6. Correct complexity claims

Let:

- \(K\) be the number of canonical reactive keys,
- \(P\) the number of emitted key-to-pattern entries,
- \(L\) the number of live entities,
- \(X\) the number of materialized wildcard-pattern/live-entity matches,
- \(T_W\) the number of entities resolved for a committed write set.

For the current implementation:

- emitted dependency metadata is \(O(K + P)\);
- the runtime dependency index is \(O(K + P + X)\);
- the live entity registry/tree is \(O(L)\);
- the dirty set and dirty reasons are worst-case \(O(L)\);
- cached static commit resolution is approximately \(O(|W_\sigma| + T_W)\)
  after lookup caches are warm, plus scheduling/render work;
- a live-registry change checks relevant wildcard patterns and updates \(X\);
- an unbounded fallback is \(O(L)\) to select a root subtree;
- rendering cost is workload-dependent and includes all selected guarded
  computations.

Dynamic signal systems commonly use space proportional to the currently
materialized source-observer edges. The correct comparison is therefore not
“\(O(0)\) versus \(O(E)\).” Both designs store runtime structures. The research
question is whether a compiler-generated, branch-insensitive index plus live
structural matching has better time/space behavior than dynamically maintained
per-execution edges for selected workloads.

That question requires measurement.

---

## 7. Evaluation needed for an academic paper

### RQ1: Coverage

What fraction of realistic TypeScript/JSX reactive code is handled as:

- exact state/path effects,
- receiver/root-bounded effects,
- parameter-relative effects,
- unbounded fallback,
- rejected unsupported syntax?

Report this over applications larger than synthetic list kernels.

### RQ2: Precision

For each mutation, compare:

- statically selected computations,
- computations whose concrete execution read the written location (measured by
  an instrumented oracle build),
- computations whose output actually changed.

This separates analysis false positives from value-guard suppression.

### RQ3: Runtime cost

Measure separately:

- mount time,
- steady-state update latency distributions,
- access-index memory,
- live entity-registry memory,
- allocations per update,
- wildcard expansion maintenance,
- DOM mutation counts,
- effect scheduling.

### RQ4: Cross-module value

Use ablations:

1. no linker/root fallback,
2. canonical imported state only,
3. exact helper summaries,
4. bounded/parameter-relative summaries,
5. full component placement and structural patterns.

Report precision gain and compile-time cost at each stage.

### RQ5: Comparison with prior models

At minimum, compare against:

- Svelte 4 legacy-style compile-time reactivity where a fair implementation is
  possible,
- Svelte 5,
- Solid,
- Vue,
- a direct/vanilla DOM baseline.

PixieDust and IceDust may not have directly runnable contemporary artifacts, so
their comparison may be semantic/architectural unless reproducibility permits a
port.

Use isolated processes, production builds, fixed framework versions, warmups,
enough samples for confidence intervals or bootstrap intervals, correctness
checks after every operation, and machine/environment disclosure. Existing
repository benchmark JSON is useful exploratory evidence, but should not be
turned into universal performance claims.

---

## 8. Limitations to state plainly

1. The analysis is for a restricted, statically resolvable subset of
   TypeScript/JavaScript, not full ECMAScript.
2. Dynamic property names, reflection, `eval`, native mutation, and unresolved
   libraries limit precision or observability.
3. A callback retained by opaque external code and invoked after the analyzed
   call returns is not made observable merely by committing after the original
   call.
4. Exception-path commit semantics are an explicit open design decision.
5. Static union-of-branches read sets can over-invalidate relative to dynamic
   tracking.
6. Wildcard row patterns can select many live instances; payload-parametric
   patterns cover only analyzable cases.
7. The current connected graph permits one top-level mount boundary.
8. Runtime HMR replacement and independently loaded chunks complicate the
   closed-world assumption.
9. The current correctness argument is conditional; the compiler and linker
   have not been mechanized.
10. A live entity registry and compiler-generated dependency index remain at
    runtime, so “zero runtime graph” must be defined narrowly or avoided.

---

## 9. Wording guide

Prefer:

- “without runtime read tracking”
- “without dynamically discovered source-observer edges”
- “compiler-generated dependency index”
- “static read/write over-approximation”
- “module-qualified reactive identity”
- “fixed-point effect-summary linking”
- “conditional completeness under stated coverage invariants”
- “direct DOM update closures”

Avoid:

- “the first static reactive compiler”
- “fully static incremental computation” as a novelty claim
- “no runtime graph” without defining which graph
- “zero runtime memory” or \(O(0)\) dependency memory
- “pure array lookup” for every commit
- “proven sound for JavaScript”
- “topologically sorted” when the implementation actually uses entity depth,
  phases, and commit passes rather than a complete static dependency DAG
- unverified claims that it outperforms other frameworks

---

## 10. Primary sources

- N. ten Veen, D. C. Harkes, and E. Visser, “PixieDust: Declarative
  Incremental User Interface Rendering Through Static Dependency Tracking,”
  WWW 2018. <https://doi.org/10.1145/3184558.3185978>
- D. C. Harkes, D. M. Groenewegen, and E. Visser, “IceDust: Incremental and
  Eventual Computation of Derived Values in Persistent Object Graphs,” ECOOP
  2016. <https://doi.org/10.4230/LIPIcs.ECOOP.2016.11>
- B. Oeyen, J. De Koster, and W. De Meuter, “Reactive Programming on the Bare
  Metal: A Formal Model for a Low-Level Reactive Virtual Machine,” REBLS 2022.
  <https://soft.vub.ac.be/Publications/2022/vub-tr-soft-22-15.pdf>
- N. Halbwachs, P. Caspi, P. Raymond, and D. Pilaud, “The Synchronous Data Flow
  Programming Language LUSTRE,” Proceedings of the IEEE, 1991.
  <https://doi.org/10.1109/5.97300>
- Y. Cai, P. G. Giarrusso, T. Rendel, and K. Ostermann, “A Theory of Changes
  for Higher-Order Languages: Incrementalizing Lambda-Calculi by Static
  Differentiation,” PLDI 2014. <https://doi.org/10.1145/2594291.2594304>
- C. Schuster and C. Flanagan, “Reactive Programming with Reactive Variables,”
  Modularity Companion 2016. <https://doi.org/10.1145/2892664.2892666>
- Svelte documentation, “Reactive `$:` statements.”
  <https://svelte.dev/docs/svelte/legacy-reactive-assignments>
- R. Harris, “Svelte 3: Rethinking Reactivity.”
  <https://svelte.dev/blog/svelte-3-rethinking-reactivity>
- The Svelte team, “Introducing Runes.”
  <https://svelte.dev/blog/runes>
- Solid documentation, “Fine-grained reactivity.”
  <https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity>
- Vue documentation, “Reactivity in Depth.”
  <https://vuejs.org/guide/extras/reactivity-in-depth.html>

The bibliography in the paper should cite the papers rather than this note.
