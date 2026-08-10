# memoized-dom evaluation artifact

This directory is a movable, self-contained evaluation package for the paper
on static reactive linking. It evaluates three claims without using a DOM or a
full-framework shootout:

1. how cross-module function summaries affect static write-effect precision;
2. whether compiler-selected computations cover independently observed reads;
3. what static-index routing costs relative to an equivalent minimal dynamic
   subscription kernel.

The consolidated paper-facing interpretation and recommended wording are in
[`FINDINGS.md`](./FINDINGS.md).

The checked-in corpus is purpose-built for the compiler's documented
TypeScript/JSX subset. It is a representative stress corpus, not a random or
statistically representative sample of production applications.

## Install and run

Requirements: Bun 1.3 or later and Node-compatible APIs equivalent to Node 24.

```bash
cd evaluation
bun install --frozen-lockfile
bun run check
bun run all
```

Individual instruments are available as `bun run coverage`, `bun run oracle`,
and `bun run routing`. Results are written to `results/` as JSON (raw data),
CSV (analysis), Markdown (paper-ready tables), and SVG (routing figure).

The artifact manifest depends on the frozen compiler package in `vendor/`:

```json
"@memoized-dom/compiler": "file:./vendor/memoized-dom-compiler-0.0.5.tgz"
```

This makes the folder movable without edits. To evaluate a newer compiler,
build it, run `bun pm pack`, copy the resulting tarball into `vendor/`, update
the one manifest path, and regenerate `bun.lock`. No source path elsewhere in
this repository is hard-coded by the runners.

## Instrument 1: corpus coverage and ablation

`src/coverage/run.ts` compiles every directory under `corpus/` twice. The full
mode uses fixed-point module summaries. The ablation preserves imported state
and component identities but deliberately replaces imported function effects
with an unbounded summary. This isolates function-summary propagation; it is
not described as disabling every form of module linking.

The site report contains file, line, column, syntax, canonical key, and tier:
exact, receiver-bounded, parameter-relative, unbounded, or rejected. It also
reports nonblank/noncomment LOC, module count, declared adaptations,
unsupported constructs, canonical reader keys, and reader edges.

The classifier counts both authored mutation expressions and effectful call
sites. This definition is recorded in every report because a call site whose
callee mutates state is an effect site even though it contains no assignment
token itself.

## Instrument 2: concrete-execution oracle

`src/oracle/instrument.ts` is a separate Babel transform. It discovers module
bindings independently, wraps concrete reads, logs writes, and uses runtime
object identity for parameter-relative helper writes. It does not call or
import memoized-dom's read/write analysis. Compiler metadata supplies only the
static selection being tested.

For each mutation:

- `S` is the compiler-selected set, including changed-derived propagation;
- `O` is the set selected by reads logged on the preceding concrete execution;
- `C` is the set of derived values that actually changed.

The runner fails immediately if `O` is not a subset of `S`. Dynamic traces are
execution-specific oracles, not proof of whole-program soundness. Every branch
of the branching case is driven explicitly, including an inactive-branch
write that exposes static over-approximation.

## Instrument 3: isolated routing kernels

`src/routing/` feeds identical deterministic topologies to:

- `static-index`: exact readers plus compiled wildcard patterns whose live
  matches are maintained at mount/unmount time;
- `dynamic-subscription`: a minimal key-to-subscriber `Set` populated during
  mount, with no framework scheduler or renderer.

Before timing, the runner asserts that both kernels return identical entity
sets for each topology. The sweep varies fan-out, wildcard density,
writes-per-commit, derived depth, and graph size. It reports construction,
mount/unmount, steady-state routing, a structural lower bound on per-route
allocation objects, and exact logical retained-representation units.

Timing results are machine-sensitive. Run at least three fresh processes on an
otherwise idle machine and report medians together with `environment.json`.
Do not describe the dynamic baseline as Solid, Vue, or Svelte; it is a minimal
reference mechanism only.

## Archival package

Before an archival release, regenerate integrity hashes and pack the complete
movable artifact:

```bash
bun run manifest
mkdir release
bun pm pack --destination release
```

Upload the resulting `memoized-dom-evaluation-0.1.0.tgz` to the archival
release. `CITATION.cff` is ready for a DOI to be added after Zenodo mints it.

## Paper-use cautions

- Do not generalize the corpus percentages to arbitrary TypeScript projects.
- Do not turn concrete-execution recall into a formal soundness claim.
- Do not compare routing-only timings with end-to-end framework benchmarks.
- Archive a tagged artifact release with a persistent DOI; a moving GitHub
  branch is useful for development but is not the archival citation.
