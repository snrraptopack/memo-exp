# Merged delivery baseline

Measured `91284dc` on 2026-10-07 before extending composition binding. These
are production bytes, not timing results from this laptop.

## Production HTML delivery

Every emitted browser chunk is counted, including future capability chunks.
Gzip is summed per chunk. HTML includes the separately reported payload.

| Authored fixture | HTML B | Payload B | Browser JS B | Gzip B |
|---|---:|---:|---:|---:|
| Static | 146 | 0 | 0 | 0 |
| Component counter | 218 | 0 | 8,613 | 3,483 |
| Input and keyed todo list | 348 | 0 | 17,140 | 6,443 |
| Fetched component rows | 882 | 370 | 51,539 | 17,077 |
| Fetched data and counter | 535 | 315 | 32,300 | 10,823 |
| Fetched data, routing and Group | 783 | 315 | 87,015 | 26,781 |

Command: `bun run bench:size:ssr --fixture=static --fixture=counter
--fixture=todo --fixture=request-component-list --fixture=request-interactive
--fixture=request-routed-group`. The command also compares an older compiler
with the current runtime; the table above records only the current build.

## Client-only reachability and browser checks

`bench:size:audit --before-ref=68c4c39 --verify` was restricted to static,
owner-counter, input-list, request-data, request-group and request-routed-group.
All 18 package/source/previous-source browser graphs passed their interaction,
input and retained-node checks. The same compiler was used in those graphs.
The previous-source comparison replaces runtime/data/router source only.

| Client-only source fixture | Before raw / gzip B | Merged raw / gzip B |
|---|---:|---:|
| Static creation | 6,355 / 2,700 | 6,439 / 2,731 |
| Owner counter | 8,912 / 3,658 | 8,996 / 3,689 |
| Input list | 16,870 / 6,715 | 16,954 / 6,737 |
| Fetched data | 28,715 / 9,996 | 29,037 / 10,098 |
| Fetched Group | 28,898 / 10,042 | 29,220 / 10,150 |
| Fetched routed Group | 72,841 / 23,427 | 73,165 / 23,543 |

Static creation here measures a CSR module that creates its document; it is
different from the production HTML static page above. The merge adds 84 raw
bytes of fixed runtime cost, and 322–324 bytes for request fixtures. No stream
document handoff or request restoration/waiter modules were retained in these
client-only graphs. Audit guards now reject either leak. Existing guards cover
transfer fingerprints and replay as well.

The `--hydrate-program` controls for the three request fixtures passed all
nine browser graphs and retained restoration/transfer as required. Source gzip
cost rose by 915–925 bytes from the previous source. This is the optional
hydration/stream recovery cost and remains a separate optimization target.

Generated detailed reports live under the ignored `bench/package-size/dist/`
directories. Re-run these commands after composition changes; compare the same
authored fixtures, build mode, runtime and compiler baseline.

## Composition binding batch

Component-row factories now receive their lexical caller's content-slot plans.
Forwarded and repeated slots bind at their callee's mount positions; subsequent
rows use the same retained creation factory. Request-selected conditionals may
contain request lists inside their single host root, and fetched rows may
contain conditionals whose alternatives each have one proved host. Missing
branches, multiple variable sibling extents and unproved row semantics still
use ordinary creation. Nested conditional planning restores its enclosing
structural context.

Production comparison uses compiler/Vite `36d6e42` and the same current runtime:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetched component rows with repeated caller children | 63,471 / 20,824 | 51,233 / 17,144 |
| Request-selected list with conditional row content | 62,143 / 20,184 | 51,976 / 17,112 |
| Existing fetched component rows | 51,539 / 17,077 | 51,539 / 17,077 |
| Existing forwarded caller children | 11,211 / 4,398 | 11,211 / 4,398 |

Run `bench:size:ssr --before-ref=36d6e42` with fixtures `request-row-children`,
`request-conditional-list`, `request-component-list` and
`composition-live-forwarded-children`. These are checked-in authored fixtures;
tests do not depend on examples.

Compiler build, root typecheck and changed-file lint pass. Seven initial plan,
list, composition, conditional and lifetime suites pass 165 checks. Two new
production Chrome checks verify no initial DOM creation/refetch, retained row
identity after refresh/reorder, repeated slot updates, local row state, branch
replacement and later row creation. Unit tests additionally verify balanced
cleanup and empty initial lists. These measurements establish delivery size
reductions, not update timing gains.

### Alternative descendant creation check

Final review found that factory collection visited only the first symbolic
alternative of a request-selected conditional. The two parser regressions
failed before the correction: the other alternative's descendant component
was missing from `creationComponents`. Collection and retained-creation
rewriting now visit every alternative. The existing shape checks continue to
reject incompatible repeated factories.

The focused request, conditional and composition suites pass 96 checks. A new
production Chrome case binds the initial descendant without creating DOM or
refetching, swaps through both request-selected alternatives, exercises each
component's counter, and verifies fresh state on recreation. Both composed
fetched-list Chrome cases continue to pass. This is a correctness correction
to the new branch proof, not a measured performance gain.
The first combined browser run exceeded this case's 60-second outer timeout;
an isolated rerun passed in 25 seconds with a 120-second outer limit. Browser
assertions and operation wait limits were preserved. Build, typecheck and lint
also pass.

## Component-owned structural creation — 2026-10-07

Fetched component rows can now bind their own request-selected conditional
content and nested request lists. Previously, the shared plan proved those
host extents but a later blanket guard rejected every structural region in a
recreated component. That guard and its slot-only exception are removed.
Future creation now propagates through branch alternatives and list row plans,
preserving static text and attributes when the same factory creates new rows.
DOM lowering and the existing conditional/list runtime engines are unchanged.

Production comparison uses compiler/Vite `931934a` and the same current runtime:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Fetched component-owned conditional and nested list | 64,915 / 21,100 | 55,047 / 18,074 |
| Fetched component rows | 51,539 / 17,077 | 51,539 / 17,077 |
| Fetched rows with caller children | 51,233 / 17,144 | 51,233 / 17,144 |
| Recreated structural caller children | 28,177 / 9,911 | 28,177 / 9,911 |
| Static production page | 0 / 0 | 0 / 0 |

The new fixture's initial HTML falls from 1,470 to 1,248 bytes; its 458-byte
request payload is unchanged. This is a delivery size improvement, not an
update timing measurement. Re-run `bench:size:ssr --before-ref=931934a` with
`--fixture=request-component-structures` and the control fixtures above.

Both parser regressions failed before the correction. Five focused compiler,
composition, list, conditional and lifetime suites pass 123 distinct checks. Two
production Chrome cases cover empty and populated initial lists: no initial
element creation or refetch, retained row and nested keyed-node identity,
reorder/refresh, independent local state, branch swaps, clearing and later
creation with fresh state and intact static content.
Compiler build, root typecheck and changed-file lint pass. Explicit negative
checks retain ordinary creation for missing branches and variable sibling lists.

Eligibility still requires proved row hosts and branch extents. Missing
request branches, incompatible repeated component shapes, closed nested
structural rows and multiple variable sibling extents remain separate proof
work. This batch adds no new hydration path or compatibility API.

## Variable region extents — 2026-10-07

The next batch completes the three extent cases listed above: absent request
branches, closed nested row structures and independent variable sibling regions.
Empty alternatives retain their opening/closing anchors. Populated alternatives
can bind a host element or composed component. Following siblings use anchor
offsets when their positions cannot be expressed by one fixed/end-relative
index. Nested closed lists retain their actual initial rows for HTML and also
prove a symbolic row factory for later binding/creation. Closed outer row plans
are merged across every row, including empty scalar slots and different initial
branch selections; incompatible shapes cannot silently reuse row zero's plan.

Anchor lookup is an optional runtime module. It scans each needed parent once
per binding call, validates balanced and unique source anchors, and passes
resolved paths to the shared binder. Every address/shape is validated before
empty text markers are replaced. The existing conditional/list engines and
creation factories remain responsible for updates and cleanup. One `pathMode`
fact selects fixed, end-relative or anchor-relative addressing; the old boolean
representation is removed rather than retained as an alias.

Production compiler/Vite comparison with `31567b2`, using the same current
runtime on both sides:

| Fixture | Before raw / gzip B | After raw / gzip B |
|---|---:|---:|
| Absent branches and independent request lists | 65,813 / 20,772 | 54,805 / 17,633 |
| Closed nested lists and conditional rows | 38,266 / 13,039 | 29,712 / 10,204 |
| Existing component-owned request structures | 55,047 / 18,074 | 55,047 / 18,074 |
| Existing request list with fixed siblings | 47,597 / 15,810 | 47,597 / 15,810 |
| Counter | 8,613 / 3,483 | 8,613 / 3,483 |
| Todo | 17,140 / 6,443 | 17,140 / 6,443 |
| Static production HTML | 0 / 0 | 0 / 0 |

The request fixture's 448-byte payload is unchanged. The closed nested fixture
no longer needs its former 78-byte hydration payload. The new optional anchor
module is included in the after measurements. Extending the shared end-relative
binder adds 121 raw / 55 gzip bytes when that module is measured in isolation
with identical esbuild settings; this is a runtime-module cost, not a complete
application delta, and is excluded from the compiler-only comparison above.
Programs that only use fixed binding paths do not retain either address resolver.

Re-run `bench:size:ssr --before-ref=31567b2` with the fixture names
`request-variable-extents`, `closed-nested-structures` and the controls above.
These are delivery size measurements, not update timing improvements.

Seven production Chrome checks pass: present/absent optional component branches,
independent request list siblings, closed nested structures and the preceding
component-owned structural controls. They verify initial binding without DOM
creation/refetch, retained keyed nodes on reorder, branch removal/recreation,
nested updates and fresh component state. Runtime checks reject missing,
unclosed, mismatched and duplicate region anchors before changing the DOM.
Nine initial-delivery regression suites pass 205 checks. Compiler/runtime builds,
root typechecking and changed-file lint pass.
Multi-host fragment branches and variable caller-slot mount extents still use
ordinary creation; the public rendering API and developer workflow are unchanged.
