# Pinned Octane js-framework comparison

This supplements our existing DOM/state-placement benchmarks. **It does not
drive or change the optimization plan**, regardless of rankings. Required
correctness, conservative partial updates, structural reconciliation and the
remaining creation/teardown work still matter. Bundle-size work remains deferred.

## Source and pin

`upstream/` is a Git submodule of [octanejs/octane](https://github.com/octanejs/octane),
pinned to `874ca5f139c6ed6f29b4970a567bc7e22b0b3ca4`. We run its
`benchmarks/js-framework/run.mjs` and `run-reorder.mjs` unchanged. Its own
`pnpm-lock.yaml` and pnpm **11.15.1** pin the benchmark dependencies separately
from memoized-dom. The runner rejects a different upstream commit or tracked edits.

Default targets: Octane TSRX, Octane JSX, React, Ripple, Solid, Vue Vapor,
Preact, Svelte, Inferno and memoized-dom. This is the upstream suite's target
list plus our adapter; its optional naive/deopt fixtures are not selected.
These are the versions at this source pin, not a claim to use each project's
newest release.

```text
bench/octane/
  upstream/           # pinned Octane repo; contains the nine framework apps
  memoized-dom/       # our App.tsx, model.ts and runtime entry main.ts
  setup.ts            # prepares the pinned dependencies and browser
  run.ts              # runs all ten apps through both upstream harnesses
  results/            # one combined report per run
```

`memoized-dom/App.tsx` is compiler-owned memoized-dom source, with component-owned state
and inline keyed table rows. Its array replacements, every-tenth-row immutable
updates, data generator and deterministic shuffle match the tuned Octane
fixtures. Generated code is rebuilt using `compileModules`; it is never edited
by hand. The runtime uses a synchronous scheduler so its completed DOM commit
is inside the harness's click window. Other targets retain their upstream
flush/scheduler arrangements. This compares authored framework paths, not
identical internal work.

Each framework has an isolated production page. The harness controls those
pages through their shared buttons/table contract; it doesn't import frameworks
into one app. Our `main.ts` imports `mount` and `setScheduler` from the runtime.
The compiler injects the runtime helpers needed by `App.tsx`.

## VM commands

From the memoized-dom repository root, with Git, Node (>=24.11) and Bun available:

```sh
git pull
bun install --frozen-lockfile
bun run build
bun run bench:octane:setup
bun run bench:octane
```

Setup initializes the exact submodule pin, keeps a sparse checkout of the
benchmark, Octane package and required patches, installs its selected workspace
from the frozen lockfile, and installs Playwright Chromium. Installation scripts
are disabled. It doesn't install dependencies into the memoized-dom workspace.
On a minimal Linux VM, install the browser's OS libraries once if needed:

```sh
cd bench/octane/upstream
bun x pnpm@11.15.1 --config.verify-deps-before-run=false --filter octane-js-framework-benchmarks exec playwright install-deps chromium
```

That OS setup may require root privileges. Return to the repository root to run.
The wrapper disables pnpm's pre-run automatic full-workspace installation;
the selected workspace is installed explicitly with its frozen lockfile.

Both suites run sequentially after all production builds. Static servers use
available local ports and are stopped when the runner exits. No development
servers or existing example ports are used.

```sh
bun run bench:octane --quick                         # three measured samples
bun run bench:octane --smoke --targets=memoized-dom   # adapter integration check
bun run bench:octane --samples=16                    # longer VM run
```

The full run uses eight samples per cell, upstream warmups and correctness
gates. `--targets=name,name` can select any of the default targets;
`--canonical-only` omits the reorder suite. Limited runs are labelled by their
target list and should not be presented as the full comparison.

## Results and limits

The user's latest full VM report at `581b40f` is preserved in
[vm-review-581b40f.md](vm-review-581b40f.md). All ten targets passed; it also
contains both DOM timing-stability runs. The CPU host changed, so historical
timings do not isolate compiler/runtime changes.

The user's first eight-sample VM run at `1fd4911` is preserved in
[vm-review-1fd4911.md](vm-review-1fd4911.md), including the DOM placement
suite. All ten targets passed. Browser downloads failed on that VM; an isolated
cache supplied the same Chromium 153 binary to every target. Keep that browser
difference in mind when comparing runs.

Each run writes `results/<UTC timestamp>/` with:

- `canonical.json` and `reorder.json`: untouched upstream results, including
  samples, scores, deterministic work metrics and reorder identity gates.
- `results.json`: both suites plus source commits, upstream lockfile hash,
  browser/tool versions, machine information and container limits when available.
- `results.md`: one combined report of median timings across all selected targets.
  Deterministic Octane-only work counts remain in JSON, separately from timings.

Failed gates or missing suite output cause a nonzero exit and mark the combined
report incomplete. Results are ignored by Git; send the combined Markdown and
JSON from the VM. The canonical harness checks changes immediately after timed
clicks; reorder gates verify order and retained row identity before timing.
Octane-specific production-call and scratch-storage gates apply only to its
targets. These gates are not identical to our DOM matrix's validation after
every timed sample.

Timing includes JavaScript and the completed DOM commit, excludes paint and
automation transport, and is not directly comparable to official Chrome timeline
js-framework-benchmark results. Repeat runs on the same VM; timer-resolution
values and uncontrolled historical comparisons cannot establish general rankings.

The adapter's shared algorithms are derived from Octane's MIT-licensed fixture;
see `LICENSE.octane` and the original source under the pinned submodule.
