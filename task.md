Here's the concrete build list, sequenced by cost and by how much it depends on things you'd need anyway. I'd do them in this order — each one also de-risks the next.

## 1. Corpus coverage + linker ablation — start here, cheapest, no runtime harness needed

This is pure static analysis output — you already have a compiler that produces exact/bounded/parameter-relative/unbounded/rejected classifications, you just need to run it over programs and count.

**Tasks:**
- Write (or port) 8–15 small programs in your analyzable TS/JSX subset. Since arbitrary GitHub apps won't compile, you'll mostly be *writing* these yourself — a todo app, a small dashboard with derived stats, a form with cross-module validation state, a shopping cart with `.push`/`.splice` mutations, something with a multi-file derived-value chain (state → derived → derived2 → component), something with helper-chain depth 3–4. Aim for variety in *what stresses the linker*, not variety in "real-world-ness."
- Add a compiler flag or build mode that dumps, per mutation/read site: file, line, canonical key (if resolved), and tier (exact/bounded/parameter-relative/unbounded/rejected).
- Add the ablation mode: same compiler, imported facts forced unbounded regardless of what linking would resolve. This is probably a single flag disabling the fixed-point cross-module propagation step.
- Run both modes over all corpus programs, produce the per-program table the paper specifies (LOC, module count, manual adaptations, site counts, tier breakdown, unsupported constructs hit).
- Compute the headline number: unbounded-site % with linking on vs. off.

**Output for the paper:** one table (per-corpus-program stats) + one summary sentence with the before/after unbounded percentage.

## 2. Precision/recall oracle — the load-bearing one, moderate effort

This is the instrument that also validates your completeness theorem, so it's worth getting right even though it's more work.

**Tasks:**
- Build the independent instrumentation pass: a second, separate transform (not reusing your compiler's own read/write analysis) that inserts `traceRead(key, computationId, value)` around every reactive read and `traceWrite(key, ...)` around every mutation, including the `.push`/`.splice`-style ones. This has to be structurally independent from your main analysis or the whole instrument is circular.
- Build a small runtime logger that records, per executed mutation: what was statically selected ($S$, from your compiler's own output), what the oracle actually observed as read on this execution ($O$), and what outputs actually changed ($C$, via your existing guard).
- Write the synthetic stress programs from §V-D of the paper: aliased imports across files, helper chains at depth 1–4, a branch that reads different state per branch, a multi-file derived chain. These can mostly reuse or extend the corpus programs from step 1.
- For each test program, manually drive every relevant branch (you need to actually execute both sides of conditionals to get oracle coverage on each), log $S$/$O$/$C$ per mutation, compute precision and recall.
- **Watch specifically for recall $<1$.** If you ever see $O \not\subseteq S$, that's a real bug in your write/read extraction, not just a number to report — fix it before writing the paper, since a published recall $<1$ would be an admitted counterexample to your own completeness theorem as implemented.

**Output for the paper:** a table of precision/recall per test-program category (aliasing, helper depth N, branching, multi-file derivation), plus one sentence characterizing where precision degrades (probably: branch-heavy code and deep helper chains, if it follows the pattern the paper predicts).

## 3. Isolated routing microbenchmark — do this last, it's the most engineering-heavy

**Tasks:**
- Build the minimal reference dynamic-subscription kernel: a bare getter/setter pair per state key with a subscriber `Set`, no scheduler beyond what's needed to match your static kernel's synchronous behavior, no rendering. This is maybe 100–150 lines — deliberately not a real framework's internals.
- Extract or expose your own static-index routing kernel in isolation from DOM/JSX, so it can run against synthetic topologies rather than real components.
- Write a parameterized topology generator: N state keys, M live entities, given fan-out, given wildcard density, given writes-per-commit — same generator feeding both kernels so the comparison is apples-to-apples.
- Instrument both kernels for: construction time, mount/unmount cost, steady-state write-routing time, retained memory (heap snapshots or manual object counting), per-update allocations.
- Sweep at minimum: low fan-out vs. high fan-out, exact vs. wildcard-heavy topologies, and increasing $d_c$ (derived-computation depth) to see how propagation passes scale.

**Output for the paper:** a small set of line/bar charts (time and memory vs. topology parameter), not a giant table — this is the instrument most likely to want a figure rather than prose numbers.

## Sequencing recommendation

Do #1 first — it needs no new infrastructure beyond a flag and a dump format, and it's the number reviewers will look for immediately (does linking actually help). Do #2 second since it's the one protecting your theorem and it's genuinely the paper's most important empirical claim. Do #3 last and treat it as optional-but-strengthening if you're tight on time — the paper already reads fine without it, since RQ1/RQ2/RQ4 alone substantiate the core claim, and RQ3 is explicitly framed as secondary to rendering-free routing cost rather than a headline result.

Want me to start scaffolding the corpus-classification dump format or the oracle instrumentation pass against your actual `analysis.ts`/`handlers.ts`, or are you doing the implementation side yourself and just wanted the task breakdown?
