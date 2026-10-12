# Desktop presentation host

The desktop target uses the existing compiler analysis and JavaScript semantic
runtime with a retained Blitz document in Rust. Application authoring remains
ordinary TSX, CSS, events, refs and `mount()` from the framework runtime.

This branch currently implements the Rust document foundation. The desktop emitter,
JavaScript publication adapter and window command are subsequent milestones. There
is no mounted application example to run yet. This package's scripts exercise the
native foundation; they do not change web mounting or select a desktop renderer.

## Native checks

Run from the repository root with the installed Rust 1.96.0 toolchain:

```powershell
bun run --cwd packages/desktop native:check
bun run --cwd packages/desktop native:test
bun run --cwd packages/desktop native:fmt
```

The crate pins Blitz revision `45496d9288b063719ebeae4e0761273f7881b3d7` and keeps
its dependency graph in `rust/Cargo.lock`. Check and test builds reuse the same
`rust/target` cache. The initial feature selection enables system fonts for text;
windowing, painting and resource features will be selected when those integrations
exist. Cold dependency compilation is not app startup or a TSX refresh measurement.

## Retained document and source identities

Rust keeps one `BaseDocument` containing the actual presentation tree. The host
adds the document's HTML/head/body shell once. There is no alternate CSS property
language, paragraph tree or reactive engine in this package.

| Record | Shape and responsibility |
| --- | --- |
| Template | Stable key and ordered source nodes; each node has an optional preceding parent index |
| Element source | Blitz qualified tag name and qualified attributes, preserving namespaces |
| Text source | Plain text destination |
| Comment source | Non-layout anchor, including structural-region destinations |
| Owner | Framework-owned instance ID and positive generation |
| Node reference | Owner ID/generation plus source index; raw engine allocation IDs are not incoming source identities |
| Instance | Source-index-to-versioned-Blitz-ID vector, start/end comments and owning destination |
| Destination | Document body, a source element's children, or the position before a source comment |

Templates validate names, duplicate attributes, parent ordering and parent kinds
before any engine allocation. Each instance has comment boundaries, including empty
and multi-root fragments. Children inserted at an element or region belong to that
destination; moves stay within it. The boundary comments add no element wrapper.

Blitz supplies element, style, text and layout behavior. A native ref exposed to
JavaScript will need an adapter for each ordinary method; these Rust records do not
claim to implement `HTMLElement`, browser geometry reads or a JavaScript `Document`.

## Writes, moves and retirement

`NativeDocument::update` validates the complete text/attribute write set before
opening a live mutator. A refusal leaves earlier candidate writes and redraw
requests unapplied. Attributes use Blitz replacement/removal, including ordinary
class/style strings. CSS inside style elements goes directly to the engine.

Instance moves retain the complete sibling range and its existing source IDs,
including descendant and empty ranges. Retirement destroys the range's native
allocations and clears every descendant instance whose boundary was destroyed.
Generation high-water marks survive retirement, so a reused instance ID cannot
accept writes from a previous generation.

Registry cleanup uses a reverse boundary index rather than scanning unrelated
instances. Finding sibling ranges and removing engine children still have their
own costs; this batch does not establish large-list throughput. Generation marks
remain for the lifetime of this native document.

Unexpected failure after entering live application is terminal. Rust reports
unknown acceptance, retains the failed state and rejects subsequent work; it does
not claim rollback. The future process connection must terminate pending work in
that state. Structural acceptance and completed layout/paint remain separate:
`resolve()` runs Blitz's style/text/layout work explicitly.

## Current boundary

The in-process document API and headless native contracts are the current scope.
It is not yet a versioned process protocol or an atomic batch combining mount,
move, write and retirement. Wire decoding, sequence acceptance, resource-provider
control and connection failure propagation remain M2 work. Window painting and
ordinary TSX mounting follow in M3; input ordering/cancellation follows in M4.

Blitz creates a text input's editor during layout construction. Tests verify both
pre-layout value initialization and later editor updates through the engine.
Attribute writes alone are not a proof of browser input parity: live/default value
distinctions, user edits, composition and stale controlled writes need the M4
contracts before the JavaScript control adapter is claimed compatible.

Read the canonical [research](../../wiki/blitz/research.md),
[plan](../../wiki/blitz/plan.md), and [completed milestones](../../wiki/blitz/milestones.md).
