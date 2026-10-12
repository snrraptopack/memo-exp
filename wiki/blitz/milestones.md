# Blitz milestone and decision record

Updated: 2026-10-12. Branch: `codex/blitz-renderer`.

Follow [plan.md](plan.md) for implementation order and [research.md](research.md)
for inspected architecture. This log is append-only for completed work: correct
an inaccurate entry explicitly rather than rewriting the historical decision.
Update the status table when the corresponding completion gates pass.

## Milestone status

| Milestone | Status | Evidence |
| --- | --- | --- |
| M0 — Architecture and plan | Completed | Initial documentation batch below |
| M1 — Shared semantic/compiler boundary | Not started | No main compiler/runtime changes in this branch |
| M2 — Native document/transactions | Not started | No Blitz native crate exists yet |
| M3 — Ordinary native counter | Not started | No desktop compiler/mount integration exists yet |
| M4 — Events and input | Not started | Upstream API inspected; process integration not tested |
| M5 — Modules and structural parity | Not started | Core implementations available; native adapter not built |
| M6 — CSS/browser parity | Not started | No Blitz application fixture measured |
| M7 — Refs/libraries/lifecycle | Not started | Capability plan only |
| M8 — Dev workflow and evidence | Not started | No Blitz build/startup/input timings recorded |

## M0: research and implementation contract

Completed: 2026-10-12.

### Baseline and scope

- Verified the current branch is `codex/blitz-renderer`, based on main commit
  `f3e1a794d5652d91bab27590519d6fb04f7a99cc`.
- Verified that main predates the desktop package and runtime/core export.
  Previous desktop work stays available on `codex/desktop-renderer`; it has not
  been merged wholesale.
- Preserved the preexisting `examples/fullstack/src/Main.tsx` edit.
- Added only this log, the implementation plan, and the Blitz research document.
  The older GPUI proposal remains historical context. These wiki documents are
  the authority for the new Blitz work.

### Research performed

Read current compiler preparation/analysis, project discovery, shared render/JSX
plans, runtime kernel/access/state-cell modules, environment capabilities, refs,
effects and external-source allocation. Reviewed the pinned Blitz document,
mutator, identity, event-driver, layout/damage, shell, paint and optional scripting
sources, plus the official feature status pages. The pinned source snapshot is
`45496d9288b063719ebeae4e0761273f7881b3d7`.

### Decisions recorded

| Decision | Rationale and consequence |
| --- | --- |
| Use Blitz as the selected native document/presentation engine | Keep ordinary HTML/CSS authoring and reuse upstream presentation work |
| Keep the existing JS semantic core | Cross-module cells, access tables, effects and external subscriptions are existing framework behavior |
| Extract one shared analysis coordinator before another emitter | Current main still mixes DOM preparation with source analysis; a shortened duplicate pipeline is unacceptable |
| Keep author-facing names `desktop` and normal mount selection | Engine choice belongs to build/host integration, not application source |
| Use direct native templates/mutations | Retain source identity and native control state without serializing complete HTML every update |
| Use ordinary CSS text and asset source URLs | Stylo performs CSS interpretation; do not copy the GPUI cascade/style language |
| Use a persistent process bridge initially | Reuse known transport/acceptance concepts while testing event latency independently |
| Freeze cancellation after synchronous JS dispatch | Preserve web timing; async completion does not block a native default |
| Defer relevant defaults without blocking the Rust UI thread | Avoid deadlocks and global input/paint waits |
| Validate complete operation batches before native mutation | Mutator flush does not provide transaction rollback |
| Fail the connection after ambiguous application | Never claim a failed live mutation left the old document intact |
| Build native code separately from TSX/CSS refresh | Avoid repeating native dependency compilation during ordinary app testing |
| Communicate existing-code changes before implementation | The user's requirement governs shared extractions, build wiring and any semantic changes |

### Verification and actual results

- Git branch, HEAD, remote-main ref, and working-tree status inspected.
- Checked source paths and upstream snapshot references against the current
  checkout and the inspected Blitz source checkout.
- Markdown local links and pinned upstream paths checked; `git diff --check`
  passed for the documentation batch.
- No JS/native tests were needed for this documentation-only batch.
- No Blitz crate has been built or run. No performance improvement is claimed.
- Commit identity and push verification are recorded by the completion message
  for this batch; locate the exact commit with
  `git log -- wiki/blitz/research.md wiki/blitz/plan.md wiki/blitz/milestones.md`.

### Next authorized batch

M1: communicate the shared analysis/core entry changes before editing them, capture
DOM compiler output baseline, and extract the smallest reviewed shared boundary.
Do not start by importing the previous GPUI renderer or creating another reactive
runtime.

## Required format for later completed batches

Append an entry with the milestone ID and batch title, completion date, baseline
commit, concrete changes, decisions and rationale, reused code, prior communication
of existing-code changes, actual checks/results, remaining limits and commit/push
verification. Link relevant source and commands. Preserve failures honestly and
do not mark an entire milestone complete based on one partial batch.
