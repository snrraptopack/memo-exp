# Evaluation findings for the static reactive linker

This document is the paper-facing summary of the reproducible results under
`results/`. It separates claims supported by the measurements from claims the
artifact does not establish.

## Executive summary

The evaluation supports the central precision and coverage claim:

- The expanded corpus contains 15 accepted programs, 48 modules, 274
  nonblank/noncomment lines, and 88 write-effect sites. One additional program
  intentionally exercises a rejected namespace import.
- With fixed-point cross-module function summaries, no accepted site was
  classified as unbounded. With imported function summaries ablated, 40 of 88
  sites became unbounded: **0% versus 45.45%**.
- An independent concrete-execution oracle ran 25 scenarios. It recorded 36
  true positives, nine false positives, and zero false negatives: **80.0%
  precision and 100% recall**.
- Three fresh-process routing runs did **not** show a universal static speed
  advantage. Static steady-state routing was slower in five of six topologies
  (1.12x--1.88x) and slightly faster in the exact high-fan-out topology
  (0.92x). Exact precomputed edges could make mounting much cheaper, while
  wildcard materialization made mounting much more expensive.

The strongest defensible conclusion is therefore:

> Fixed-point ES-module linking materially improves the precision of static
> reactive effect routing within the supported TypeScript/JSX subset, while
> retaining all dependencies observed in the tested concrete executions. It
> shifts dependency work across compile, mount, and update phases; it is not an
> inherent steady-state speedup over dynamic subscriptions.

## Experimental environment

The recorded environment was:

- Bun 1.3.14 with Node v24.3.0 compatibility;
- 64-bit Windows;
- AMD PRO A12-9800B, four logical CPUs;
- deterministic generated routing topologies;
- 1,024 routing warmup operations;
- nine in-process timing samples per fresh process;
- seven lifecycle samples per process;
- three fresh routing processes for the replicated result.

The exact environment and Git state are stored in
`results/environment.json`. Timing should be rerun on the final publication
machine; coverage and oracle results are deterministic correctness results.

## RQ1: What does cross-module linking contribute?

### Method

Every accepted program was compiled twice:

1. **Linked:** normal fixed-point module analysis.
2. **Function summaries ablated:** imported state and component identities are
   preserved, but imported function effects are replaced by an unbounded
   summary.

The ablation is intentionally narrow. Calling it “all module linking disabled”
would be inaccurate because canonical imported state identity remains enabled.

A write-effect site is either an authored mutation expression or a call whose
inferred function summary contains a write effect. The tiers are:

- **exact:** a canonical binding or property path is known;
- **receiver-bounded:** the effect is bounded to a known reactive receiver;
- **parameter-relative:** the mutation is expressed relative to a helper
  argument and substituted at the caller;
- **unbounded:** no finite reactive boundary is available;
- **rejected:** the source shape is outside the supported subset.

### Aggregate result

| Mode | Exact | Receiver-bounded | Parameter-relative | Unbounded | Unbounded rate |
|---|---:|---:|---:|---:|---:|
| Full fixed-point linking | 35 | 24 | 29 | 0 | **0.00%** |
| Imported function summaries ablated | 19 | 8 | 21 | 40 | **45.45%** |

Thus, linked function summaries prevented **40 of 88 effect sites** from
degrading to root-level invalidation in this corpus.

### Corpus composition

| Program group | Programs | Purpose |
|---|---:|---|
| Aliasing and re-exports | 2 | Canonical state identity across renamed imports and an explicit re-export bridge |
| Helper-depth stress | 3 | Parameter-relative propagation at depths one, two, and four |
| Analysis stress | 3 | Conditional reads, dynamic store keys, and form validation |
| Derived chains | 1 | State through two derived modules into a view |
| Application cases | 5 | Todo board, inventory, permissions, notifications, and finance |
| Collection case | 1 | Cart push, splice, and exact scalar fields |
| Expected rejection | 1 | Namespace import of reactive exports |

The five application cases account for 23 modules and 140 lines. The full
per-program classification, source locations, syntax, canonical keys, and
declared unsupported constructs are in `results/coverage.json` and
`results/coverage.csv`.

### Paper-ready wording

> Across a purpose-built corpus of 15 accepted programs (48 modules, 274
> nonblank/noncomment LOC, and 88 write-effect sites), fixed-point imported
> function summaries reduced unbounded sites from 45.45% to 0%. The ablation
> preserved canonical imported state/component identity and disabled only
> cross-module function-summary propagation.

Do not shorten this to “linking eliminates all unbounded writes.” The result is
specific to the supported, purpose-built corpus.

## RQ2: Does static selection cover concrete dependencies?

### Method and notation

The oracle uses a second Babel transform that does not import or call the
compiler's read/write analysis. It independently:

- discovers module bindings;
- wraps concrete lexical and object-path reads;
- logs actual writes;
- uses runtime object identity to recover parameter-relative writes; and
- evaluates every relevant conditional direction.

For each mutation:

- **S** is the set selected by the compiler's static table;
- **O** is the set selected by reads observed on the preceding concrete
  execution;
- **C** is the set of derived outputs whose values actually changed.

The runner fails immediately when `O` is not a subset of `S`.

### Aggregate result

| Metric | Result |
|---|---:|
| Cases | 7 |
| Concrete scenarios | 25 |
| True positives | 36 |
| False positives | 9 |
| False negatives | **0** |
| Precision | **80.0%** |
| Recall | **100.0%** |

### Result by stress category

| Category | Scenarios | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|
| Aliasing | 6 | 9 | 3 | 0 | 75.0% | 100% |
| Helper depth | 3 | 3 | 0 | 0 | 100% | 100% |
| Branching | 6 | 4 | 2 | 0 | 66.7% | 100% |
| Multi-file derivation | 3 | 6 | 0 | 0 | 100% | 100% |
| Path precision | 4 | 8 | 4 | 0 | 66.7% | 100% |
| Receiver mutation | 3 | 6 | 0 | 0 | 100% | 100% |

The false positives reveal two sources of conservatism:

1. **Inactive branches.** A static branch union includes a location that the
   preceding execution did not read. The computation is selected, but its
   output guard observes no change.
2. **Cross-field/module-object over-approximation.** Some aliased object and
   independent-field cases select a sibling computation in addition to the two
   concretely affected computations.

No tested alias chain, four-level parameter helper chain, derived chain, or
collection receiver mutation produced a false negative.

### Paper-ready wording

> Across 25 concrete executions covering aliases, four-level helper
> propagation, both directions of conditional dependencies, independent
> object paths, collection receiver mutations, and cross-module derived
> chains, the compiler achieved 100% concrete-execution recall and 80.0%
> precision (36 TP, 9 FP, 0 FN). False positives arose from inactive branch
> unions and cross-field/module-object over-approximation.

This is implementation evidence, not proof of whole-program soundness. A
dynamic trace observes one execution; it cannot establish correctness for
unexecuted inputs, exceptions, opaque retained callbacks, reflection, or
dynamically loaded code.

## RQ3: What does the routing representation cost?

### Method

The benchmark compares two rendering-free kernels fed the same deterministic
topology:

- **Static index:** exact readers plus wildcard patterns whose live matches
  are materialized during lifecycle changes.
- **Dynamic subscriptions:** a minimal key-to-subscriber `Set` populated at
  mount time.

This dynamic kernel is not Solid, Vue, or Svelte. Both kernels use the same
path-matching and synchronous propagation rules. The harness verifies identical
selected entity sets before timing.

### Replicated steady-state routing

Each number is the median of three fresh processes. Brackets contain the
process minimum and maximum.

| Topology | Static ns [range] | Dynamic ns [range] | Static/dynamic |
|---|---:|---:|---:|
| Exact, low fan-out | 7,452.1 [5,919.9, 10,337.7] | 3,971.4 [3,916.9, 4,508.5] | **1.88x** |
| Exact, high fan-out | 73,045.8 [59,451.1, 73,546.8] | 79,609.1 [63,970.5, 92,187.5] | **0.92x** |
| Wildcard-heavy | 32,848.6 [32,325.2, 52,210.1] | 26,005.8 [25,483.1, 27,386.0] | **1.26x** |
| Four writes/commit | 69,240.7 [68,871.5, 73,891.2] | 45,324.3 [42,516.5, 46,360.7] | **1.53x** |
| Derived depth four | 42,692.6 [38,199.1, 68,087.7] | 31,517.6 [23,914.3, 32,935.9] | **1.35x** |
| Large topology | 94,934.1 [91,105.3, 99,657.1] | 84,657.6 [83,758.8, 92,088.8] | **1.12x** |

Static routing was slower in five steady-state tests, ranging from 1.12x to
1.88x the dynamic reference. It was 0.92x the dynamic time in the exact
high-fan-out case. This mixed result does not support a universal speed claim.

### Lifecycle trade-off

| Topology | Static mount ns/entity | Dynamic mount ns/entity | Interpretation |
|---|---:|---:|---|
| Exact, low fan-out | 575.5 | 1,109.7 | Static about **1.9x cheaper** |
| Exact, high fan-out | 360.3 | 9,755.6 | Static about **27.1x cheaper** |
| Wildcard-heavy | 127,540.5 | 3,721.8 | Static about **34.3x slower** |
| Four writes/commit | 22,138.1 | 1,516.0 | Static about **14.6x slower** |
| Derived depth four | 25,144.6 | 1,291.9 | Static about **19.5x slower** |
| Large topology | 229,717.2 | 5,517.7 | Static about **41.6x slower** |

Exact precomputed edges avoid installing many dynamic subscriber entries.
Wildcard-heavy topologies reverse that advantage because the static kernel
tests and materializes structural matches when entities mount.

Exact logical retained-edge counts were equal. In wildcard cases the static
representation retained both wildcard patterns and their materialized matches,
adding approximately 1.5--2.3% logical representation units in these
topologies. Both kernels had the same structural lower bound on result-routing
allocation objects for equal propagation depth.

### Paper-ready wording

> A rendering-free mechanism benchmark found no universal steady-state speed
> advantage for the static index: it was slower in five of six deterministic
> topologies (1.12x--1.88x) and slightly faster in the exact high-fan-out case
> (0.92x). Lifecycle costs depended on representation. Exact high-fan-out
> mounting was approximately 27x cheaper statically, whereas wildcard-heavy
> static mounting was approximately 34x slower because live structural matches
> were materialized.

These results must not be used to rank complete frameworks. They exclude DOM
work, rendering, browser scheduling, and each framework's production
optimizations.

## What the complete evaluation establishes

The evidence supports these claims:

1. The fixed-point module linker materially improves write-effect precision in
   the supported corpus.
2. Parameter-relative effects remain precise through a tested four-level
   helper chain.
3. Canonical reactive identity survives tested aliases, explicit re-exports,
   and multi-file derived chains.
4. Every dependency observed by the independent oracle was contained in the
   compiler selection for the 25 tested executions.
5. Static analysis incurs predictable over-approximation at inactive branches
   and some module-object/path boundaries.
6. Static linking changes where dependency costs occur; it does not guarantee
   faster steady-state routing.

The evidence does not establish:

- soundness for full JavaScript or TypeScript;
- zero runtime dependency memory;
- zero false positives;
- superiority over Solid, Vue, Svelte, React, or another full framework;
- statistically representative ecosystem coverage; or
- browser/application-level performance.

## Threats to validity to include in the paper

- **Corpus selection:** The programs are purpose-built for the supported
  language subset. The 45.45% ablation result is not an ecosystem estimate.
- **Oracle scope:** Twenty-five concrete executions cannot cover all inputs or
  replace a proof of analysis soundness.
- **Oracle independence:** The instrumentation analysis is separately
  implemented, but both analyses operate on the same JavaScript syntax and can
  share conceptual blind spots.
- **Timing platform:** Timing comes from one Windows machine. The report uses
  fresh-process ranges, but another CPU/runtime may change the ratios.
- **Minimal baseline:** The dynamic kernel isolates dependency routing but does
  not represent the optimized internals of a named framework.
- **Excluded costs:** The mechanism benchmark excludes compilation, DOM
  mutation, rendering, browser event-loop behavior, and application logic.
- **Static wildcard policy:** The measured mount trade-off depends on eagerly
  materializing wildcard/live-entity matches; another static runtime could use
  a different policy.
- **Unsupported boundaries:** Namespace imports, reflection, native mutation,
  dynamic imports, retained opaque callbacks, and exceptional exits require
  rejection, fallback, or further soundness work.

## Recommended headline

Use a headline centered on precision and module linking:

> Static reactive linking reduced unbounded effect sites from 45.45% to 0% in
> a 15-program supported corpus and achieved 100% recall against an independent
> 25-execution oracle, at the cost of conservative false positives and without
> a demonstrated steady-state routing speedup.

## Source files for tables and replication

- `results/coverage.json`, `coverage.csv`, and `coverage.md` contain corpus and
  per-site classification data.
- `results/oracle.json`, `oracle.csv`, and `oracle.md` contain every `S`, `O`,
  and `C` set.
- `results/routing-run-1.json` through `routing-run-3.json` contain the fresh
  process measurements.
- `results/routing-replicated.json`, `routing-replicated.csv`, and
  `routing-replicated.md` contain the cross-process aggregates.
- `results/environment.json` records the machine and sampling policy.

Run everything with:

```bash
bun install --frozen-lockfile
bun run check
bun run all
```

## Complete generated evidence ledger

Everything below this heading is regenerated directly from the JSON outputs by
`bun run findings`. It deliberately repeats some summary values above so this
single file remains sufficient for independent paper writing and review.

<!-- GENERATED-EVIDENCE:START -->

### Evidence generation metadata

| Field | Value |
|---|---|
| generatedAt | 2026-08-08T16:10:37.900Z |
| runtime | Bun 1.3.14 |
| nodeCompatibility | v24.3.0 |
| platform | win32 |
| architecture | x64 |
| cpu | AMD PRO A12-9800B R7, 12 COMPUTE CORES 4C+8G    |
| logicalCpus | 4 |
| gitCommit | c23297e8c7ef876b6ff48be75e250cc48480b272 |
| gitDirty | true |
| benchmarkPolicy | {"deterministicTopologies":true,"warmupRoutes":1024,"timingSamples":9,"lifecycleSamples":7} |
| Coverage generated | 2026-08-08T16:10:48.921Z |
| Oracle generated | 2026-08-08T16:10:55.953Z |
| Replicated routing generated | 2026-08-08T16:11:54.027Z |

The recorded Git state is intentionally disclosed. A camera-ready artifact should rerun this ledger from the final tagged revision so `gitDirty` is false and the commit identifies the archived source.

### Complete coverage and ablation ledger

The corpus loader found 16 programs: 15 accepted programs with 48 modules and 274 LOC, plus 1 expected rejection.

| Mode | Exact | Receiver-bounded | Parameter-relative | Unbounded | Rejected | Unbounded rate |
|---|---:|---:|---:|---:|---:|---:|
| Linked | 35 | 24 | 29 | 0 | 0 | 0.00% |
| Function summaries ablated | 19 | 8 | 21 | 40 | 0 | 45.45% |

#### Every corpus program

| Program | Category | Expected | LOC | Modules | Adaptations | Unsupported constructs | Linked E/B/P/U/R | Ablated E/B/P/U/R | Linked reader keys/edges |
|---|---|---|---:|---:|---|---|---:|---:|---:|
| alias-imports | cross-module aliasing | accept | 15 | 3 | none | none | 4/0/0/0/0 | 2/0/0/2/0 | 3/6 |
| branch-reads | branch over-approximation | accept | 10 | 2 | none | none | 6/0/0/0/0 | 3/0/0/3/0 | 3/6 |
| dashboard-derived | derived chain | accept | 18 | 4 | none | none | 4/0/0/0/0 | 2/0/0/2/0 | 5/10 |
| dynamic-key | dynamic store key | accept | 8 | 2 | none | none | 0/2/0/0/0 | 0/1/0/1/0 | 3/6 |
| finance-summary | application case study | accept | 25 | 5 | none | none | 9/0/0/0/0 | 4/0/0/5/0 | 7/17 |
| form-validation | parameter effects | accept | 19 | 3 | none | none | 0/0/7/0/0 | 0/0/5/2/0 | 7/14 |
| helper-depth-1 | helper depth 1 | accept | 11 | 2 | none | none | 0/1/2/0/0 | 0/0/2/1/0 | 2/4 |
| helper-depth-2 | helper depth 2 | accept | 14 | 2 | none | none | 0/1/3/0/0 | 0/0/3/1/0 | 2/4 |
| helper-depth-4 | helper depth 4 | accept | 14 | 2 | none | none | 0/1/5/0/0 | 0/0/5/1/0 | 2/4 |
| inventory-dashboard | application case study | accept | 26 | 5 | none | none | 2/2/4/0/0 | 1/0/2/5/0 | 11/20 |
| notification-center | application case study | accept | 24 | 4 | none | none | 1/6/0/0/0 | 1/3/0/3/0 | 7/16 |
| permissions-form | application case study | accept | 26 | 4 | none | none | 2/2/4/0/0 | 2/0/2/4/0 | 6/12 |
| reexport-chain | re-export linking | accept | 10 | 3 | none | none | 2/0/0/0/0 | 1/0/0/1/0 | 2/4 |
| rejected-namespace | unsupported import shape | reject | 6 | 2 | none | namespace import of reactive exports | 0/0/0/0/1 | 0/0/0/0/1 | 0/0 |
| shopping-cart | receiver-bounded collection | accept | 15 | 2 | none | none | 2/4/0/0/0 | 1/2/0/3/0 | 4/8 |
| todo-board | application case study | accept | 39 | 5 | none | none | 3/5/4/0/0 | 2/2/2/6/0 | 9/22 |

Tier tuple order is exact / receiver-bounded / parameter-relative / unbounded / rejected.

#### Program: alias-imports

One state binding and mutator imported under aliases by two views.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 15/3. Reader keys/edges: 3/6.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./header.tsx:4:33 | effect-call | <code>recordVisit()</code> | exact<br>./state.ts#profile.visits | unbounded<br>no finite key | imported function summary |
| ./sidebar.tsx:4:33 | effect-call | <code>setName('Grace')</code> | exact<br>./state.ts#profile.name | unbounded<br>no finite key | imported function summary |
| ./state.ts:4:3 | mutation | <code>profile.visits++</code> | exact<br>./state.ts#profile.visits | exact<br>./state.ts#profile.visits | statically resolved property path |
| ./state.ts:8:3 | mutation | <code>profile.name = next</code> | exact<br>./state.ts#profile.name | exact<br>./state.ts#profile.name | statically resolved property path |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#profile | App<br>App/* | App<br>App/* |
| ./state.ts#profile.name | App<br>App/* | App<br>App/* |
| ./state.ts#profile.visits | App<br>App/* | App<br>App/* |

#### Program: branch-reads

A branch reads disjoint state while actions update each source.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 10/2. Reader keys/edges: 3/6.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:5:34 | mutation | <code>showingPrimary = !showingPrimary</code> | exact<br>./state.ts#showingPrimary | exact<br>./state.ts#showingPrimary | static module-state binding |
| ./state.ts:6:39 | mutation | <code>primary++</code> | exact<br>./state.ts#primary | exact<br>./state.ts#primary | static module-state binding |
| ./state.ts:7:41 | mutation | <code>secondary++</code> | exact<br>./state.ts#secondary | exact<br>./state.ts#secondary | static module-state binding |
| ./view.tsx:4:42 | effect-call | <code>toggle()</code> | exact<br>./state.ts#showingPrimary | unbounded<br>no finite key | imported function summary |
| ./view.tsx:4:90 | effect-call | <code>bumpPrimary()</code> | exact<br>./state.ts#primary | unbounded<br>no finite key | imported function summary |
| ./view.tsx:4:144 | effect-call | <code>bumpSecondary()</code> | exact<br>./state.ts#secondary | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#primary | App<br>App/* | App<br>App/* |
| ./state.ts#secondary | App<br>App/* | App<br>App/* |
| ./state.ts#showingPrimary | App<br>App/* | App<br>App/* |

#### Program: dashboard-derived

Dashboard counters with two cross-module derived stages.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 18/4. Reader keys/edges: 5/10.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:5:3 | mutation | <code>sales++</code> | exact<br>./state.ts#sales | exact<br>./state.ts#sales | static module-state binding |
| ./state.ts:9:3 | mutation | <code>refunds++</code> | exact<br>./state.ts#refunds | exact<br>./state.ts#refunds | static module-state binding |
| ./view.tsx:5:42 | effect-call | <code>recordSale()</code> | exact<br>./state.ts#sales | unbounded<br>no finite key | imported function summary |
| ./view.tsx:5:92 | effect-call | <code>recordRefund()</code> | exact<br>./state.ts#refunds | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./derived.ts#gross | App/$computed/.%2Fsummary.ts#net | App/$computed/.%2Fsummary.ts#net |
| ./derived.ts#loss | App/$computed/.%2Fsummary.ts#net | App/$computed/.%2Fsummary.ts#net |
| ./state.ts#refunds | App<br>App/$computed/.%2Fderived.ts#loss<br>App/* | App/$computed/.%2Fderived.ts#loss |
| ./state.ts#sales | App<br>App/$computed/.%2Fderived.ts#gross<br>App/* | App/$computed/.%2Fderived.ts#gross |
| ./summary.ts#net | App<br>App/* | App<br>App/* |

#### Program: dynamic-key

Dynamic property writes stay bounded to a known store root.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 8/2. Reader keys/edges: 3/6.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:4:3 | mutation | <code>settings[key] = value</code> | receiver-bounded<br>./state.ts#settings | receiver-bounded<br>./state.ts#settings | dynamic path bounded to a canonical receiver |
| ./view.tsx:4:33 | effect-call | <code>updateSetting('theme', 'light')</code> | receiver-bounded<br>./state.ts#settings | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#settings | App<br>App/* | App<br>App/* |
| ./state.ts#settings.locale | App<br>App/* | App<br>App/* |
| ./state.ts#settings.theme | App<br>App/* | App<br>App/* |

#### Program: finance-summary

Balances and rates flow through two cross-module derivation stages.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 25/5. Reader keys/edges: 7/17.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./actions.ts:3:57 | mutation | <code>accounts.checking += amount</code> | exact<br>./state.ts#accounts.checking | exact<br>./state.ts#accounts.checking | statically resolved property path |
| ./actions.ts:4:57 | mutation | <code>accounts.savings -= amount</code> | exact<br>./state.ts#accounts.savings | exact<br>./state.ts#accounts.savings | statically resolved property path |
| ./actions.ts:5:38 | mutation | <code>accounts.currency = 'EUR'</code> | exact<br>./state.ts#accounts.currency | exact<br>./state.ts#accounts.currency | statically resolved property path |
| ./actions.ts:6:50 | effect-call | <code>setRate(rate)</code> | exact<br>./state.ts#usdToEur | unbounded<br>no finite key | imported function summary |
| ./state.ts:10:3 | mutation | <code>usdToEur = rate</code> | exact<br>./state.ts#usdToEur | exact<br>./state.ts#usdToEur | static module-state binding |
| ./view.tsx:6:42 | effect-call | <code>depositChecking(100)</code> | exact<br>./state.ts#accounts.checking | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:103 | effect-call | <code>withdrawSavings(50)</code> | exact<br>./state.ts#accounts.savings | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:164 | effect-call | <code>chooseEuro()</code> | exact<br>./state.ts#accounts.currency | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:218 | effect-call | <code>updateRate(0.92)</code> | exact<br>./state.ts#usdToEur | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./balances.ts#totalUsd | App/$computed/.%2Fconverted.ts#displayedTotal | App/$computed/.%2Fconverted.ts#displayedTotal |
| ./converted.ts#displayedTotal | App<br>App/* | App<br>App/* |
| ./state.ts#accounts | App<br>App/$computed/.%2Fbalances.ts#totalUsd<br>App/$computed/.%2Fconverted.ts#displayedTotal<br>App/* | App<br>App/$computed/.%2Fbalances.ts#totalUsd<br>App/$computed/.%2Fconverted.ts#displayedTotal<br>App/* |
| ./state.ts#accounts.checking | App<br>App/$computed/.%2Fbalances.ts#totalUsd<br>App/* | App/$computed/.%2Fbalances.ts#totalUsd |
| ./state.ts#accounts.currency | App<br>App/$computed/.%2Fconverted.ts#displayedTotal<br>App/* | App<br>App/$computed/.%2Fconverted.ts#displayedTotal<br>App/* |
| ./state.ts#accounts.savings | App<br>App/$computed/.%2Fbalances.ts#totalUsd<br>App/* | App/$computed/.%2Fbalances.ts#totalUsd |
| ./state.ts#usdToEur | App/$computed/.%2Fconverted.ts#displayedTotal | App/$computed/.%2Fconverted.ts#displayedTotal |

#### Program: form-validation

Form fields passed through parameter-relative validation helpers.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 19/3. Reader keys/edges: 7/14.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./validation.ts:2:3 | mutation | <code>field.touched = true</code> | parameter-relative<br>argument[0].touched | parameter-relative<br>argument[0].touched | write relative to a function parameter |
| ./validation.ts:6:3 | mutation | <code>field.value = field.value.trim()</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | write relative to a function parameter |
| ./validation.ts:6:17 | mutation | <code>field.value.trim()</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | method call relative to a function parameter |
| ./validation.ts:10:3 | effect-call | <code>normalize(field)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./validation.ts:11:3 | effect-call | <code>touch(field)</code> | parameter-relative<br>argument[0].touched | parameter-relative<br>argument[0].touched | local function summary |
| ./view.tsx:5:39 | effect-call | <code>prepare(form.email)</code> | parameter-relative<br>argument[0].touched&lt;br&gt;argument[0].value | unbounded<br>no finite key | imported function summary |
| ./view.tsx:5:131 | effect-call | <code>prepare(form.name)</code> | parameter-relative<br>argument[0].touched&lt;br&gt;argument[0].value | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#form | App<br>App/* | App<br>App/* |
| ./state.ts#form.email | App<br>App/* | App<br>App/* |
| ./state.ts#form.email.touched | App<br>App/* | App<br>App/* |
| ./state.ts#form.email.value | App<br>App/* | App<br>App/* |
| ./state.ts#form.name | App<br>App/* | App<br>App/* |
| ./state.ts#form.name.touched | App<br>App/* | App<br>App/* |
| ./state.ts#form.name.value | App<br>App/* | App<br>App/* |

#### Program: helper-depth-1

One parameter-relative helper between action and store.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 11/2. Reader keys/edges: 2/4.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:4:3 | mutation | <code>target.value++</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | write relative to a function parameter |
| ./state.ts:8:3 | effect-call | <code>write(counter)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./view.tsx:4:33 | effect-call | <code>increment()</code> | receiver-bounded<br>./state.ts#counter.value | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#counter | App<br>App/* | App<br>App/* |
| ./state.ts#counter.value | App<br>App/* | App<br>App/* |

#### Program: helper-depth-2

Two helper calls propagate a parameter-relative write.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 14/2. Reader keys/edges: 2/4.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:4:3 | mutation | <code>target.value++</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | write relative to a function parameter |
| ./state.ts:8:3 | effect-call | <code>write(target)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./state.ts:12:3 | effect-call | <code>layer1(counter)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./view.tsx:4:33 | effect-call | <code>increment()</code> | receiver-bounded<br>./state.ts#counter.value | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#counter | App<br>App/* | App<br>App/* |
| ./state.ts#counter.value | App<br>App/* | App<br>App/* |

#### Program: helper-depth-4

Four helper calls propagate one parameter-relative write.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 14/2. Reader keys/edges: 2/4.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:4:3 | mutation | <code>target.value++</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | write relative to a function parameter |
| ./state.ts:7:59 | effect-call | <code>write(target)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./state.ts:8:59 | effect-call | <code>layer1(target)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./state.ts:9:59 | effect-call | <code>layer2(target)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./state.ts:12:3 | effect-call | <code>layer3(counter)</code> | parameter-relative<br>argument[0].value | parameter-relative<br>argument[0].value | local function summary |
| ./view.tsx:4:33 | effect-call | <code>increment()</code> | receiver-bounded<br>./state.ts#counter.value | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#counter | App<br>App/* | App<br>App/* |
| ./state.ts#counter.value | App<br>App/* | App<br>App/* |

#### Program: inventory-dashboard

Inventory state, parameter helpers, imported actions, and derived valuation.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 26/5. Reader keys/edges: 11/20.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./actions.ts:4:39 | effect-call | <code>restock(inventory.pens, 5)</code> | parameter-relative<br>argument[0].quantity | unbounded<br>no finite key | imported function summary |
| ./actions.ts:5:40 | effect-call | <code>reprice(inventory.books, 18)</code> | parameter-relative<br>argument[0].price | unbounded<br>no finite key | imported function summary |
| ./actions.ts:6:39 | mutation | <code>inventory.selected = 'books'</code> | exact<br>./state.ts#inventory.selected | exact<br>./state.ts#inventory.selected | statically resolved property path |
| ./helpers.ts:2:3 | mutation | <code>item.quantity += amount</code> | parameter-relative<br>argument[0].quantity | parameter-relative<br>argument[0].quantity | write relative to a function parameter |
| ./helpers.ts:6:3 | mutation | <code>item.price = price</code> | parameter-relative<br>argument[0].price | parameter-relative<br>argument[0].price | write relative to a function parameter |
| ./view.tsx:6:42 | effect-call | <code>restockPens()</code> | receiver-bounded<br>./state.ts#inventory.pens.quantity | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:96 | effect-call | <code>repriceBooks()</code> | receiver-bounded<br>./state.ts#inventory.books.price | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:151 | effect-call | <code>selectBooks()</code> | exact<br>./state.ts#inventory.selected | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./derived.ts#bookValue | App/$computed/.%2Fderived.ts#totalValue | App/$computed/.%2Fderived.ts#totalValue |
| ./derived.ts#penValue | App/$computed/.%2Fderived.ts#totalValue | App/$computed/.%2Fderived.ts#totalValue |
| ./derived.ts#totalValue | App<br>App/* | App<br>App/* |
| ./state.ts#inventory | App<br>App/$computed/.%2Fderived.ts#bookValue<br>App/$computed/.%2Fderived.ts#penValue<br>App/* | App<br>App/$computed/.%2Fderived.ts#bookValue<br>App/$computed/.%2Fderived.ts#penValue<br>App/* |
| ./state.ts#inventory.books | App<br>App/$computed/.%2Fderived.ts#bookValue<br>App/* | App/$computed/.%2Fderived.ts#bookValue |
| ./state.ts#inventory.books.price | App/$computed/.%2Fderived.ts#bookValue | App/$computed/.%2Fderived.ts#bookValue |
| ./state.ts#inventory.books.quantity | App/$computed/.%2Fderived.ts#bookValue | App/$computed/.%2Fderived.ts#bookValue |
| ./state.ts#inventory.pens | App<br>App/$computed/.%2Fderived.ts#penValue<br>App/* | App/$computed/.%2Fderived.ts#penValue |
| ./state.ts#inventory.pens.price | App/$computed/.%2Fderived.ts#penValue | App/$computed/.%2Fderived.ts#penValue |
| ./state.ts#inventory.pens.quantity | App/$computed/.%2Fderived.ts#penValue | App/$computed/.%2Fderived.ts#penValue |
| ./state.ts#inventory.selected | App<br>App/* | App<br>App/* |

#### Program: notification-center

Notification queue mutations and a cross-module unread derivation.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 24/4. Reader keys/edges: 7/16.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./actions.ts:4:3 | mutation | <code>center.notices.push({ id: center.nextId++, message, read: false })</code> | receiver-bounded<br>./state.ts#center.notices | receiver-bounded<br>./state.ts#center.notices | method call conservatively bounded to a reactive receiver |
| ./actions.ts:4:29 | mutation | <code>center.nextId++</code> | exact<br>./state.ts#center.nextId | exact<br>./state.ts#center.nextId | statically resolved property path |
| ./actions.ts:13:3 | mutation | <code>center.notices.shift()</code> | receiver-bounded<br>./state.ts#center.notices | receiver-bounded<br>./state.ts#center.notices | method call conservatively bounded to a reactive receiver |
| ./derived.ts:3:23 | mutation | <code>center.notices.filter((notice) =&gt; !notice.read)</code> | receiver-bounded<br>./state.ts#center.notices | receiver-bounded<br>./state.ts#center.notices | method call conservatively bounded to a reactive receiver |
| ./view.tsx:5:40 | effect-call | <code>notify('saved')</code> | receiver-bounded<br>./state.ts#center.notices | unbounded<br>no finite key | imported function summary |
| ./view.tsx:5:95 | effect-call | <code>markFirstRead()</code> | receiver-bounded<br>./state.ts#center | unbounded<br>no finite key | imported function summary |
| ./view.tsx:5:148 | effect-call | <code>dismissFirst()</code> | receiver-bounded<br>./state.ts#center.notices | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./derived.ts#totalNotices | App<br>App/* | App<br>App/* |
| ./derived.ts#unread | App<br>App/* | App<br>App/* |
| ./state.ts#center | App<br>App/$computed/.%2Fderived.ts#totalNotices<br>App/$computed/.%2Fderived.ts#unread<br>App/* | App/$computed/.%2Fderived.ts#totalNotices<br>App/$computed/.%2Fderived.ts#unread |
| ./state.ts#center.nextId | App<br>App/* | $\varnothing$ |
| ./state.ts#center.notices | App<br>App/$computed/.%2Fderived.ts#totalNotices<br>App/$computed/.%2Fderived.ts#unread<br>App/* | App/$computed/.%2Fderived.ts#totalNotices<br>App/$computed/.%2Fderived.ts#unread |
| ./state.ts#center.notices.filter | App/$computed/.%2Fderived.ts#unread | App/$computed/.%2Fderived.ts#unread |
| ./state.ts#center.notices.length | App/$computed/.%2Fderived.ts#totalNotices | App/$computed/.%2Fderived.ts#totalNotices |

#### Program: permissions-form

Nested permission records updated through reusable parameter-relative helpers.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 26/4. Reader keys/edges: 6/12.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./actions.ts:5:3 | effect-call | <code>grantWrite(permissions.editor)</code> | parameter-relative<br>argument[0].write | unbounded<br>no finite key | imported function summary |
| ./actions.ts:6:3 | mutation | <code>permissions.dirty = true</code> | exact<br>./state.ts#permissions.dirty | exact<br>./state.ts#permissions.dirty | statically resolved property path |
| ./actions.ts:10:3 | effect-call | <code>revokeRead(permissions.reviewer)</code> | parameter-relative<br>argument[0].read | unbounded<br>no finite key | imported function summary |
| ./actions.ts:11:3 | mutation | <code>permissions.dirty = true</code> | exact<br>./state.ts#permissions.dirty | exact<br>./state.ts#permissions.dirty | statically resolved property path |
| ./helpers.ts:2:3 | mutation | <code>role.write = true</code> | parameter-relative<br>argument[0].write | parameter-relative<br>argument[0].write | write relative to a function parameter |
| ./helpers.ts:6:3 | mutation | <code>role.read = false</code> | parameter-relative<br>argument[0].read | parameter-relative<br>argument[0].read | write relative to a function parameter |
| ./view.tsx:5:39 | effect-call | <code>enableEditor()</code> | receiver-bounded<br>./state.ts#permissions.editor.write | unbounded<br>no finite key | imported function summary |
| ./view.tsx:5:93 | effect-call | <code>disableReviewer()</code> | receiver-bounded<br>./state.ts#permissions.reviewer.read | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#permissions | App<br>App/* | App<br>App/* |
| ./state.ts#permissions.dirty | App<br>App/* | App<br>App/* |
| ./state.ts#permissions.editor | App<br>App/* | App<br>App/* |
| ./state.ts#permissions.editor.write | App<br>App/* | App<br>App/* |
| ./state.ts#permissions.reviewer | App<br>App/* | App<br>App/* |
| ./state.ts#permissions.reviewer.read | App<br>App/* | App<br>App/* |

#### Program: reexport-chain

State and mutator are re-exported before an aliased import.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 10/3. Reader keys/edges: 2/4.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:4:3 | mutation | <code>model.value++</code> | exact<br>./state.ts#model.value | exact<br>./state.ts#model.value | statically resolved property path |
| ./view.tsx:4:33 | effect-call | <code>runChange()</code> | exact<br>./state.ts#model.value | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#model | App<br>App/* | App<br>App/* |
| ./state.ts#model.value | App<br>App/* | App<br>App/* |

#### Program: rejected-namespace

Namespace imports deliberately erase named reactive identity.

- Expected result: reject. Linked accepted: false. Ablated accepted: false.
- LOC/modules: 6/2. Reader keys/edges: 0/0.
- Linked diagnostic: <code>memo-dom: namespace import 'state' from './state' cannot identify a reactive export; use named imports</code>
- Ablated diagnostic: <code>memo-dom: namespace import 'state' from './state' cannot identify a reactive export; use named imports</code>

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| &lt;module graph&gt;:0:0 | rejection | <code>(diagnostic)</code> | rejected<br>no finite key | rejected<br>no finite key | memo-dom: namespace import 'state' from './state' cannot identify a reactive export; use named imports |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| none | $\varnothing$ | $\varnothing$ |

#### Program: shopping-cart

Cart collection with receiver mutations and exact scalar fields.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 15/2. Reader keys/edges: 4/8.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./state.ts:6:3 | mutation | <code>cart.items.push(item)</code> | receiver-bounded<br>./state.ts#cart.items | receiver-bounded<br>./state.ts#cart.items | method call conservatively bounded to a reactive receiver |
| ./state.ts:10:3 | mutation | <code>cart.items.splice(index, 1)</code> | receiver-bounded<br>./state.ts#cart.items | receiver-bounded<br>./state.ts#cart.items | method call conservatively bounded to a reactive receiver |
| ./state.ts:14:3 | mutation | <code>cart.discount = value</code> | exact<br>./state.ts#cart.discount | exact<br>./state.ts#cart.discount | statically resolved property path |
| ./view.tsx:4:42 | effect-call | <code>add({ id: 1, title: 'Book', price: 20 })</code> | receiver-bounded<br>./state.ts#cart.items | unbounded<br>no finite key | imported function summary |
| ./view.tsx:4:119 | effect-call | <code>remove(0)</code> | receiver-bounded<br>./state.ts#cart.items | unbounded<br>no finite key | imported function summary |
| ./view.tsx:4:168 | effect-call | <code>setDiscount(5)</code> | exact<br>./state.ts#cart.discount | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./state.ts#cart | App<br>App/* | App<br>App/* |
| ./state.ts#cart.discount | App<br>App/* | App<br>App/* |
| ./state.ts#cart.items | App<br>App/* | App<br>App/* |
| ./state.ts#cart.items.length | App<br>App/* | App<br>App/* |

#### Program: todo-board

A multi-module task board with collection mutations, filters, and derived counts.

- Expected result: accept. Linked accepted: true. Ablated accepted: true.
- LOC/modules: 39/5. Reader keys/edges: 9/22.

| Location | Kind | Authored syntax | Linked tier and keys | Ablated tier and keys | Analysis detail |
|---|---|---|---|---|---|
| ./actions.ts:5:3 | mutation | <code>board.todos.push({ id: board.nextId++, title, done: false })</code> | receiver-bounded<br>./state.ts#board.todos | receiver-bounded<br>./state.ts#board.todos | method call conservatively bounded to a reactive receiver |
| ./actions.ts:5:26 | mutation | <code>board.nextId++</code> | exact<br>./state.ts#board.nextId | exact<br>./state.ts#board.nextId | statically resolved property path |
| ./actions.ts:10:14 | effect-call | <code>toggleItem(first)</code> | parameter-relative<br>argument[0].done | unbounded<br>no finite key | imported function summary |
| ./actions.ts:15:14 | effect-call | <code>renameItem(first, title)</code> | parameter-relative<br>argument[0].title | unbounded<br>no finite key | imported function summary |
| ./actions.ts:19:3 | mutation | <code>board.filter = filter</code> | exact<br>./state.ts#board.filter | exact<br>./state.ts#board.filter | statically resolved property path |
| ./derived.ts:4:26 | mutation | <code>board.todos.filter((todo) =&gt; todo.done)</code> | receiver-bounded<br>./state.ts#board.todos | receiver-bounded<br>./state.ts#board.todos | method call conservatively bounded to a reactive receiver |
| ./helpers.ts:4:3 | mutation | <code>todo.done = !todo.done</code> | parameter-relative<br>argument[0].done | parameter-relative<br>argument[0].done | write relative to a function parameter |
| ./helpers.ts:8:3 | mutation | <code>todo.title = title</code> | parameter-relative<br>argument[0].title | parameter-relative<br>argument[0].title | write relative to a function parameter |
| ./view.tsx:6:42 | effect-call | <code>addTodo('write paper')</code> | receiver-bounded<br>./state.ts#board.todos | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:101 | effect-call | <code>toggleFirst()</code> | receiver-bounded<br>./state.ts#board | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:154 | effect-call | <code>renameFirst('revise paper')</code> | receiver-bounded<br>./state.ts#board | unbounded<br>no finite key | imported function summary |
| ./view.tsx:6:221 | effect-call | <code>setFilter('open')</code> | exact<br>./state.ts#board.filter | unbounded<br>no finite key | imported function summary |

Static reader table (canonical key to structural entity patterns):

| Canonical read key | Linked entity patterns | Ablated entity patterns |
|---|---|---|
| ./derived.ts#completed | App<br>App/$computed/.%2Fderived.ts#remaining<br>App/* | App<br>App/$computed/.%2Fderived.ts#remaining<br>App/* |
| ./derived.ts#remaining | App<br>App/* | App<br>App/* |
| ./derived.ts#total | App<br>App/$computed/.%2Fderived.ts#remaining<br>App/* | App<br>App/$computed/.%2Fderived.ts#remaining<br>App/* |
| ./state.ts#board | App<br>App/$computed/.%2Fderived.ts#completed<br>App/$computed/.%2Fderived.ts#total<br>App/* | App<br>App/$computed/.%2Fderived.ts#completed<br>App/$computed/.%2Fderived.ts#total<br>App/* |
| ./state.ts#board.filter | App<br>App/* | App<br>App/* |
| ./state.ts#board.nextId | App<br>App/* | $\varnothing$ |
| ./state.ts#board.todos | App<br>App/$computed/.%2Fderived.ts#completed<br>App/$computed/.%2Fderived.ts#total<br>App/* | App/$computed/.%2Fderived.ts#completed<br>App/$computed/.%2Fderived.ts#total |
| ./state.ts#board.todos.filter | App/$computed/.%2Fderived.ts#completed | App/$computed/.%2Fderived.ts#completed |
| ./state.ts#board.todos.length | App/$computed/.%2Fderived.ts#total | App/$computed/.%2Fderived.ts#total |


### Complete concrete-execution oracle ledger

Cases/scenarios: 7/25. TP=36, FP=9, FN=0, precision=80.0%, recall=100.0%.

| # | Case | Category | Scenario | Actual writes W | Static selection S | Oracle selection O | Changed outputs C | TP/FP/FN | Precision/recall |
|---:|---|---|---|---|---|---|---|---:|---:|
| 1 | aliased-import | aliasing | increment through exported mutator | ./state.ts#model.count | App/$computed/.%2Fderived.ts#doubled | App/$computed/.%2Fderived.ts#doubled | App/$computed/.%2Fderived.ts#doubled | 1/0/0 | 100.0% / 100.0% |
| 2 | aliased-import | aliasing | decrement through the same alias | ./state.ts#model.count | App/$computed/.%2Fderived.ts#doubled | App/$computed/.%2Fderived.ts#doubled | App/$computed/.%2Fderived.ts#doubled | 1/0/0 | 100.0% / 100.0% |
| 3 | aliased-import | aliasing | exact reset through defining export | ./state.ts#model.count | App/$computed/.%2Fderived.ts#doubled | App/$computed/.%2Fderived.ts#doubled | App/$computed/.%2Fderived.ts#doubled | 1/0/0 | 100.0% / 100.0% |
| 4 | helper-depth-four | helper depth | four-level parameter-relative chain | ./state.ts#model.value | App/$computed/.%2Fderived.ts#display | App/$computed/.%2Fderived.ts#display | App/$computed/.%2Fderived.ts#display | 1/0/0 | 100.0% / 100.0% |
| 5 | helper-depth-four | helper depth | repeat four-level chain | ./state.ts#model.value | App/$computed/.%2Fderived.ts#display | App/$computed/.%2Fderived.ts#display | App/$computed/.%2Fderived.ts#display | 1/0/0 | 100.0% / 100.0% |
| 6 | helper-depth-four | helper depth | second parameter-relative leaf | ./state.ts#model.value | App/$computed/.%2Fderived.ts#display | App/$computed/.%2Fderived.ts#display | App/$computed/.%2Fderived.ts#display | 1/0/0 | 100.0% / 100.0% |
| 7 | conditional-branch | branching | inactive branch write | ./state.ts#secondary | App/$computed/.%2Fderived.ts#selected | $\varnothing$ | $\varnothing$ | 0/1/0 | 0.0% / 100.0% |
| 8 | conditional-branch | branching | active primary branch write | ./state.ts#primary | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | 1/0/0 | 100.0% / 100.0% |
| 9 | conditional-branch | branching | switch active branch | ./state.ts#primaryMode | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | 1/0/0 | 100.0% / 100.0% |
| 10 | conditional-branch | branching | now-inactive primary write | ./state.ts#primary | App/$computed/.%2Fderived.ts#selected | $\varnothing$ | $\varnothing$ | 0/1/0 | 0.0% / 100.0% |
| 11 | conditional-branch | branching | new active branch write | ./state.ts#secondary | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | 1/0/0 | 100.0% / 100.0% |
| 12 | conditional-branch | branching | switch back to primary | ./state.ts#primaryMode | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | App/$computed/.%2Fderived.ts#selected | 1/0/0 | 100.0% / 100.0% |
| 13 | cross-module-derived-chain | multi-file derivation | propagate through two files | ./state.ts#value | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | 2/0/0 | 100.0% / 100.0% |
| 14 | cross-module-derived-chain | multi-file derivation | repeat two-file propagation | ./state.ts#value | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | 2/0/0 | 100.0% / 100.0% |
| 15 | cross-module-derived-chain | multi-file derivation | reverse two-file propagation | ./state.ts#value | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | App/$computed/.%2Fderived.ts#doubled<br>App/$computed/.%2Fderived2.ts#label | 2/0/0 | 100.0% / 100.0% |
| 16 | independent-object-fields | path precision | left path first write | ./state.ts#model.left | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fsum.ts#sum | 2/1/0 | 66.7% / 100.0% |
| 17 | independent-object-fields | path precision | right path first write | ./state.ts#model.right | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | 2/1/0 | 66.7% / 100.0% |
| 18 | independent-object-fields | path precision | left path repeated write | ./state.ts#model.left | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fsum.ts#sum | 2/1/0 | 66.7% / 100.0% |
| 19 | independent-object-fields | path precision | right path repeated write | ./state.ts#model.right | App/$computed/.%2Fleft.ts#leftLabel<br>App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | App/$computed/.%2Fright.ts#rightLabel<br>App/$computed/.%2Fsum.ts#sum | 2/1/0 | 66.7% / 100.0% |
| 20 | multiple-import-aliases | aliasing | first alias chain | ./state.ts#pair.first | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared<br>App/$computed/.%2Fsecond.ts#secondSquared | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared | 2/1/0 | 66.7% / 100.0% |
| 21 | multiple-import-aliases | aliasing | second alias chain | ./state.ts#pair.second | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared<br>App/$computed/.%2Fsecond.ts#secondSquared | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Fsecond.ts#secondSquared | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Fsecond.ts#secondSquared | 2/1/0 | 66.7% / 100.0% |
| 22 | multiple-import-aliases | aliasing | first alias chain repeated | ./state.ts#pair.first | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared<br>App/$computed/.%2Fsecond.ts#secondSquared | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared | App/$computed/.%2Fcombined.ts#combined<br>App/$computed/.%2Ffirst.ts#firstSquared | 2/1/0 | 66.7% / 100.0% |
| 23 | collection-receiver | receiver mutation | array push receiver | ./state.ts#bag.items | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | App/$computed/.%2Fderived.ts#size | 2/0/0 | 100.0% / 100.0% |
| 24 | collection-receiver | receiver mutation | array shift receiver | ./state.ts#bag.items | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | 2/0/0 | 100.0% / 100.0% |
| 25 | collection-receiver | receiver mutation | array splice receiver | ./state.ts#bag.items | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | App/$computed/.%2Fderived.ts#first<br>App/$computed/.%2Fderived.ts#size | App/$computed/.%2Fderived.ts#first | 2/0/0 | 100.0% / 100.0% |

#### Oracle interpretation by scenario

1. **aliased-import — increment through exported mutator:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
2. **aliased-import — decrement through the same alias:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
3. **aliased-import — exact reset through defining export:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
4. **helper-depth-four — four-level parameter-relative chain:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
5. **helper-depth-four — repeat four-level chain:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
6. **helper-depth-four — second parameter-relative leaf:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
7. **conditional-branch — inactive branch write:** The static branch union selected a computation whose inactive path was not read on the preceding execution. No derived output changed.
8. **conditional-branch — active primary branch write:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
9. **conditional-branch — switch active branch:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
10. **conditional-branch — now-inactive primary write:** The static branch union selected a computation whose inactive path was not read on the preceding execution. No derived output changed.
11. **conditional-branch — new active branch write:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
12. **conditional-branch — switch back to primary:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
13. **cross-module-derived-chain — propagate through two files:** Static selection exactly covered the concretely observed dependency set. 2 derived output(s) changed.
14. **cross-module-derived-chain — repeat two-file propagation:** Static selection exactly covered the concretely observed dependency set. 2 derived output(s) changed.
15. **cross-module-derived-chain — reverse two-file propagation:** Static selection exactly covered the concretely observed dependency set. 2 derived output(s) changed.
16. **independent-object-fields — left path first write:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
17. **independent-object-fields — right path first write:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
18. **independent-object-fields — left path repeated write:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
19. **independent-object-fields — right path repeated write:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
20. **multiple-import-aliases — first alias chain:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
21. **multiple-import-aliases — second alias chain:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
22. **multiple-import-aliases — first alias chain repeated:** The current module-object/path analysis conservatively selected an additional sibling computation. 2 derived output(s) changed.
23. **collection-receiver — array push receiver:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.
24. **collection-receiver — array shift receiver:** Static selection exactly covered the concretely observed dependency set. 2 derived output(s) changed.
25. **collection-receiver — array splice receiver:** Static selection exactly covered the concretely observed dependency set. 1 derived output(s) changed.

### Complete routing benchmark ledger

Fresh processes: 3. Each process contains nine timed routing samples after 1,024 warmups and seven lifecycle samples.

#### Generated topology parameters

| Topology | Keys | Entities | Fan-out | Wildcard density | Writes/commit | Derived depth |
|---|---:|---:|---:|---:|---:|---:|
| exact-low-fanout | 128 | 256 | 2 | 0.0% | 1 | 1 |
| exact-high-fanout | 128 | 256 | 64 | 0.0% | 1 | 1 |
| wildcard-heavy | 128 | 256 | 32 | 75.0% | 1 | 1 |
| batched-writes | 128 | 256 | 16 | 25.0% | 4 | 1 |
| derived-depth-4 | 128 | 256 | 16 | 25.0% | 1 | 4 |
| large-topology | 512 | 1024 | 32 | 50.0% | 2 | 2 |

#### Cross-process aggregate

| Topology | Kernel | Construct ms [range] | Mount ns/entity | Unmount ns/entity | Route median ns [range] | Route P95 ns | Route CV | Minimum allocation objects/route | Result entries/route | Retained exact/pattern/materialized/subscription | Checksum |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| exact-low-fanout | static-index | 0.4785 [0.4655, 0.4804] | 575.5 | 3400.0 | 7452.1 [5919.9, 10337.7] | 22328.2 | 0.2838 | 9.0 | 3.0 | 257/0/0/0 | 55296 |
| exact-low-fanout | dynamic-subscription | 0.1339 [0.0876, 0.1730] | 1109.7 | 1784.0 | 3971.4 [3916.9, 4508.5] | 8190.8 | 0.0791 | 9.0 | 3.0 | 0/0/0/257 | 55296 |
| exact-high-fanout | static-index | 5.6400 [4.2888, 6.2752] | 360.3 | 960.0 | 73045.8 [59451.1, 73546.8] | 96085.6 | 0.1164 | 9.0 | 65.0 | 8193/0/0/0 | 1198080 |
| exact-high-fanout | dynamic-subscription | 0.0480 [0.0449, 0.0524] | 9755.6 | 16392.0 | 79609.1 [63970.5, 92187.5] | 116939.7 | 0.1799 | 9.0 | 65.0 | 0/0/0/8193 | 1198080 |
| wildcard-heavy | static-index | 1.9053 [1.6675, 2.8117] | 127540.5 | 31348.0 | 32848.6 [32325.2, 52210.1] | 77487.5 | 0.2896 | 9.0 | 33.0 | 1025/96/3072/0 | 608256 |
| wildcard-heavy | dynamic-subscription | 0.0848 [0.0713, 0.1204] | 3721.8 | 6800.0 | 26005.8 [25483.1, 27386.0] | 33136.0 | 0.0374 | 9.0 | 33.0 | 0/0/0/4097 | 608256 |
| batched-writes | static-index | 1.1953 [0.7228, 1.4402] | 22138.1 | 6156.0 | 69240.7 [68871.5, 73891.2] | 96601.5 | 0.0396 | 9.0 | 61.1 | 1537/32/512/0 | 1125873 |
| batched-writes | dynamic-subscription | 0.0856 [0.0576, 0.1168] | 1516.0 | 1632.0 | 45324.3 [42516.5, 46360.7] | 56976.2 | 0.0445 | 9.0 | 61.1 | 0/0/0/2049 | 1125873 |
| derived-depth-4 | static-index | 0.9649 [0.8206, 1.9936] | 25144.6 | 9007.7 | 42692.6 [38199.1, 68087.7] | 65421.0 | 0.3245 | 18.0 | 20.0 | 1540/32/512/0 | 368640 |
| derived-depth-4 | dynamic-subscription | 0.0724 [0.0668, 0.0730] | 1291.9 | 1276.9 | 31517.6 [23914.3, 32935.9] | 38457.3 | 0.1647 | 18.0 | 20.0 | 0/0/0/2052 | 368640 |
| large-topology | static-index | 4.9681 [4.7446, 7.0677] | 229717.2 | 134223.5 | 94934.1 [91105.3, 99657.1] | 168639.2 | 0.0450 | 12.0 | 65.1 | 8194/256/8192/0 | 1199448 |
| large-topology | dynamic-subscription | 0.2397 [0.2112, 0.7259] | 5517.7 | 5158.8 | 84657.6 [83758.8, 92088.8] | 101559.9 | 0.0527 | 12.0 | 65.1 | 0/0/0/16386 | 1199448 |

CV is the sample standard deviation divided by the mean of the three process medians. Retained values are logical representation-unit counts, not VM heap bytes. Allocation objects are a structural lower bound.

#### Fresh routing process 1

Generated: 2026-08-08T16:11:14.895Z.

| Topology | Kernel | Construct ms | Mount ns/entity | Unmount ns/entity | Route median ns | Route P95 ns | Minimum allocation objects/route | Result entries/route | Retained exact/pattern/materialized/subscription | Checksum |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| exact-low-fanout | static-index | 0.4655 | 575.5 | 2708.0 | 5919.9 | 8578.1 | 9.0 | 3.0 | 257/0/0/0 | 55296 |
| exact-low-fanout | dynamic-subscription | 0.1730 | 1040.9 | 3644.0 | 3971.4 | 5578.6 | 9.0 | 3.0 | 0/0/0/257 | 55296 |
| exact-high-fanout | static-index | 4.2888 | 339.7 | 960.0 | 59451.1 | 76530.4 | 9.0 | 65.0 | 8193/0/0/0 | 1198080 |
| exact-high-fanout | dynamic-subscription | 0.0480 | 7582.1 | 12544.0 | 63970.5 | 108600.4 | 9.0 | 65.0 | 0/0/0/8193 | 1198080 |
| wildcard-heavy | static-index | 1.9053 | 86005.4 | 31348.0 | 32325.2 | 77487.5 | 9.0 | 33.0 | 1025/96/3072/0 | 608256 |
| wildcard-heavy | dynamic-subscription | 0.0713 | 3248.6 | 6800.0 | 25483.1 | 30162.0 | 9.0 | 33.0 | 0/0/0/4097 | 608256 |
| batched-writes | static-index | 1.1953 | 22138.1 | 5568.0 | 73891.2 | 109471.6 | 9.0 | 61.1 | 1537/32/512/0 | 1125873 |
| batched-writes | dynamic-subscription | 0.0576 | 1214.8 | 1184.0 | 42516.5 | 193958.9 | 9.0 | 61.1 | 0/0/0/2049 | 1125873 |
| derived-depth-4 | static-index | 1.9936 | 38346.5 | 9007.7 | 68087.7 | 129432.5 | 18.0 | 20.0 | 1540/32/512/0 | 368640 |
| derived-depth-4 | dynamic-subscription | 0.0730 | 1166.2 | 1242.3 | 23914.3 | 38457.3 | 18.0 | 20.0 | 0/0/0/2052 | 368640 |
| large-topology | static-index | 4.7446 | 219216.0 | 94118.6 | 91105.3 | 203135.5 | 12.0 | 65.1 | 8194/256/8192/0 | 1199448 |
| large-topology | dynamic-subscription | 0.2112 | 4634.6 | 4526.5 | 84657.6 | 91333.5 | 12.0 | 65.1 | 0/0/0/16386 | 1199448 |

#### Fresh routing process 2

Generated: 2026-08-08T16:11:34.524Z.

| Topology | Kernel | Construct ms | Mount ns/entity | Unmount ns/entity | Route median ns | Route P95 ns | Minimum allocation objects/route | Result entries/route | Retained exact/pattern/materialized/subscription | Checksum |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| exact-low-fanout | static-index | 0.4804 | 493.8 | 3400.0 | 7452.1 | 26111.7 | 9.0 | 3.0 | 257/0/0/0 | 55296 |
| exact-low-fanout | dynamic-subscription | 0.0876 | 1109.7 | 1060.0 | 3916.9 | 20414.1 | 9.0 | 3.0 | 0/0/0/257 | 55296 |
| exact-high-fanout | static-index | 6.2752 | 360.3 | 928.0 | 73045.8 | 123396.9 | 9.0 | 65.0 | 8193/0/0/0 | 1198080 |
| exact-high-fanout | dynamic-subscription | 0.0524 | 9755.6 | 16392.0 | 92187.5 | 145222.9 | 9.0 | 65.0 | 0/0/0/8193 | 1198080 |
| wildcard-heavy | static-index | 2.8117 | 134100.8 | 28936.0 | 52210.1 | 181283.1 | 9.0 | 33.0 | 1025/96/3072/0 | 608256 |
| wildcard-heavy | dynamic-subscription | 0.1204 | 4458.0 | 8160.0 | 27386.0 | 33136.0 | 9.0 | 33.0 | 0/0/0/4097 | 608256 |
| batched-writes | static-index | 1.4402 | 25511.7 | 10084.0 | 69240.7 | 96601.5 | 9.0 | 61.1 | 1537/32/512/0 | 1125873 |
| batched-writes | dynamic-subscription | 0.0856 | 2433.9 | 3332.0 | 45324.3 | 56399.3 | 9.0 | 61.1 | 0/0/0/2049 | 1125873 |
| derived-depth-4 | static-index | 0.8206 | 23583.5 | 6665.4 | 38199.1 | 50056.7 | 18.0 | 20.0 | 1540/32/512/0 | 368640 |
| derived-depth-4 | dynamic-subscription | 0.0724 | 1801.2 | 1553.8 | 31517.6 | 33455.0 | 18.0 | 20.0 | 0/0/0/2052 | 368640 |
| large-topology | static-index | 4.9681 | 303005.0 | 150334.3 | 94934.1 | 107923.9 | 12.0 | 65.1 | 8194/256/8192/0 | 1199448 |
| large-topology | dynamic-subscription | 0.7259 | 9400.7 | 11173.5 | 83758.8 | 101559.9 | 12.0 | 65.1 | 0/0/0/16386 | 1199448 |

#### Fresh routing process 3

Generated: 2026-08-08T16:11:53.692Z.

| Topology | Kernel | Construct ms | Mount ns/entity | Unmount ns/entity | Route median ns | Route P95 ns | Minimum allocation objects/route | Result entries/route | Retained exact/pattern/materialized/subscription | Checksum |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| exact-low-fanout | static-index | 0.4785 | 601.6 | 3492.0 | 10337.7 | 22328.2 | 9.0 | 3.0 | 257/0/0/0 | 55296 |
| exact-low-fanout | dynamic-subscription | 0.1339 | 1329.6 | 1784.0 | 4508.5 | 8190.8 | 9.0 | 3.0 | 0/0/0/257 | 55296 |
| exact-high-fanout | static-index | 5.6400 | 595.3 | 1188.0 | 73546.8 | 96085.6 | 9.0 | 65.0 | 8193/0/0/0 | 1198080 |
| exact-high-fanout | dynamic-subscription | 0.0449 | 16387.9 | 27840.0 | 79609.1 | 116939.7 | 9.0 | 65.0 | 0/0/0/8193 | 1198080 |
| wildcard-heavy | static-index | 1.6675 | 127540.5 | 37740.0 | 32848.6 | 57965.1 | 9.0 | 33.0 | 1025/96/3072/0 | 608256 |
| wildcard-heavy | dynamic-subscription | 0.0848 | 3721.8 | 5132.0 | 26005.8 | 39536.8 | 9.0 | 33.0 | 0/0/0/4097 | 608256 |
| batched-writes | static-index | 0.7228 | 20994.2 | 6156.0 | 68871.5 | 74868.8 | 9.0 | 61.1 | 1537/32/512/0 | 1125873 |
| batched-writes | dynamic-subscription | 0.1168 | 1516.0 | 1632.0 | 46360.7 | 56976.2 | 9.0 | 61.1 | 0/0/0/2049 | 1125873 |
| derived-depth-4 | static-index | 0.9649 | 25144.6 | 12076.9 | 42692.6 | 65421.0 | 18.0 | 20.0 | 1540/32/512/0 | 368640 |
| derived-depth-4 | dynamic-subscription | 0.0668 | 1291.9 | 1276.9 | 32935.9 | 48490.1 | 18.0 | 20.0 | 0/0/0/2052 | 368640 |
| large-topology | static-index | 7.0677 | 229717.2 | 134223.5 | 99657.1 | 168639.2 | 12.0 | 65.1 | 8194/256/8192/0 | 1199448 |
| large-topology | dynamic-subscription | 0.2397 | 5517.7 | 5158.8 | 92088.8 | 137520.5 | 12.0 | 65.1 | 0/0/0/16386 | 1199448 |

#### Direct static/dynamic comparison from cross-process medians

| Topology | Static route ns | Dynamic route ns | Static/dynamic | Static mount ns/entity | Dynamic mount ns/entity | Static/dynamic mount |
|---|---:|---:|---:|---:|---:|---:|
| exact-low-fanout | 7452.1 | 3971.4 | 1.88x | 575.5 | 1109.7 | 0.52x |
| exact-high-fanout | 73045.8 | 79609.1 | 0.92x | 360.3 | 9755.6 | 0.04x |
| wildcard-heavy | 32848.6 | 26005.8 | 1.26x | 127540.5 | 3721.8 | 34.27x |
| batched-writes | 69240.7 | 45324.3 | 1.53x | 22138.1 | 1516.0 | 14.60x |
| derived-depth-4 | 42692.6 | 31517.6 | 1.35x | 25144.6 | 1291.9 | 19.46x |
| large-topology | 94934.1 | 84657.6 | 1.12x | 229717.2 | 5517.7 | 41.63x |

<!-- GENERATED-EVIDENCE:END -->
