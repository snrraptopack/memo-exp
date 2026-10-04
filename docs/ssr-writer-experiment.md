# Retained leaf SSR writer experiment

Status: opt-in prototype; not enabled by Vite or default compilation.

The branch already replaces array child operations with intrusive sibling
links, avoids repeated escape/parse work, centralizes rendering in one request
session, moves LinkeDOM into its oracle entry, and commits streamed responses
after route preparation. Phase 6 measures those changes through the real
application dispatcher. This experiment targets the next remaining cost:
building interior nodes in thousands of repeated leaf rows.

## Decision and rationale

A second whole-application JSX renderer would duplicate semantics for data
availability, keyed identities, route preparation, getters, and request cells.
An append-only writer would also need another mechanism to update output while
async data settles. Neither choice is justified just because it is familiar
elsewhere.

Instead, the compiler starts with the existing lowered creation and update
plan. For a proven leaf row it emits an alternate factory path that stores
the same text/class snapshots and update callback, but returns one opaque
string extent instead of constructing the row's interior element/text nodes.
The existing list runtime still creates markers, validates keys, retains
entries, replaces props, replays updates, moves extents, and disposes them.
Serialization reads the stored snapshots. It never re-runs authored JSX or
calls authored getters to get the latest values.

This uses the framework's existing strength: compiler-proven ownership and
precise replay. The experimental unit is a **retained output extent**, whose
HTML expression is compiled directly; there is no runtime template program
or segment-array interpreter. The enclosing document and structural regions
still use the string tier. The application body and payload remain atomic.

## Proof boundary

`ssrWriter: true` on `compile()` or `compileModules()` requests the experiment.
It only accepts existing lightweight listed component factories with one
element root and a connected, statically known host tree. Supported dynamic
writes are text snapshots and normalized classes; literal scalar attributes
are escaped at compilation. Runtime text and class escaping reuse the string
tier's escape functions.

A literal JSX class is folded into the HTML only when the lowered plan proves
exactly one literal `setClassValue` call during creation and none in the
updater. The compiler applies the string case of `classValue` (trim) and
attribute escaping once. Expression classes and every class with an updater
write retain their snapshots and evaluation order.

Every generated reference to an interior node must be a recognized write.
Unsupported operations reject the entire candidate before changing its plan.
Examples include nested structural regions, nested components, events/refs,
spreads, styles, dynamic attributes, form properties, raw-text elements,
foreign namespaces, custom elements, and disconnected/moved creation trees.
Inline map rows are not optimized in this prototype.

The alternative activates only when the request document provides the
`htmlWriter` capability. Browser creation, hydration, and the LinkeDOM oracle
execute the ordinary factory path. The default compiler option is false, so
ordinary client builds acquire no capability check or alternate code. An
opt-in module retains both paths for oracle parity; its extra emitted code
size is measured explicitly.

## Evidence and limits

The parity tests compare exact plain and marked string output, normalized DOM
oracle output, retained DOM node identity after hydration, getter evaluation
counts, and a same-key replacement while request data settles. Factory-count
tests prove interior element/text construction is removed. Unsupported shapes
must keep the fallback and remain byte-identical to the baseline.
Concurrent renders with request-owned module cells also preserve distinct row
snapshots and payload parity.
An imported row component with its own request-owned prefix cell also passes
concurrent settlement, same-key replacement, insertion, and reordering. Both
requests mount before the mutations begin; each retains its own row text,
class, order, prefix, and payload.

An empty dynamic text slot exposes a pre-existing hydration recovery edge:
empty HTML text has no physical text node to adopt. The experiment preserves
the baseline output and recovery diagnostics. Non-empty row adoption is
tested independently; this prototype makes no new empty-text adoption claim.

The writer benchmark uses paired alternating batches and retains all samples.
It measures both marker policies, emitted code growth, and element/text factory
counts. Local latency improvements need repetition across runtimes and an
idle host before default activation. Fewer factory calls do not by themselves
prove fewer total allocations or lower RSS.

## Promotion criteria

1. Keep exact output and payload parity through shell, resolve, timeout,
   cancellation, and keyed replacement/reordering scenarios.
2. Show repeated CPU/latency gains on eligible, representative workloads and
   no material fallback regression. Include HTML size and emitted code size.
3. Measure the real HTTP path with the writer enabled; faster synchronous
   serialization alone does not prove a useful completion/throughput gain.
4. Extend the request-cell isolation evidence to imported row components
   before enabling it in SSR builds (the bounded imported-row fixture now
   passes; retain this gate as the supported operation surface expands).
5. Extend one proven operation class at a time. Preserve update order and
   evaluation count; do not add a general string interpreter to accommodate
   unsupported shapes.

If the proof or code-size cost outweighs the measured gain, keep the string
tier as the production choice. Novelty is useful here only when it removes
work without changing observable behavior.
