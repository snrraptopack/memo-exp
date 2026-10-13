# Desktop presentation host

The desktop target uses the existing compiler analysis and JavaScript semantic
runtime with a retained Blitz document in Rust. Application authoring remains
ordinary TSX, CSS, events, refs and `mount()` from the framework runtime.

This branch currently implements the Rust document foundation and ordered wire
acceptance for complete mount/write/move/retire publications. The desktop emitter,
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
not claim rollback. The publication session closes in that state; a future process
driver must fail pending jobs and terminate the transport. Structural acceptance
and completed layout/paint remain separate:
`resolve()` runs Blitz's style/text/layout work explicitly.

## Ordered wire publication

`PublicationSession` owns the native document for one connection. It accepts a
complete JSON packet through `publish(bytes)`, validates decoding and sequencing,
then calls the combined native transaction validator. It exposes the
document for immutable inspection, with no mutable escape hatch.

The operation array supports text/attributes and structural publication:

```json
{
  "version": 1,
  "sequence": 1,
  "operations": [
    {
      "op": "text",
      "target": { "owner": { "id": "App", "generation": 1 }, "source": 1 },
      "value": "Count: 1"
    }
  ]
}
```

`setAttribute` carries the same target, a qualified `name` with `namespace`,
`local` and optional `prefix`, and a string `value`. `removeAttribute` carries
the target/name without a value. Removal is an explicit operation; a missing or
null set value is refused rather than treated as removal. Names and node kinds
are checked by the existing document layer. Namespace strings reach Blitz intact.

`mount` carries `owner`, an immutable `template` key and a `target` destination.
Destinations are `{"kind":"body"}`, or `{"kind":"element","source":...}` /
`{"kind":"region","source":...}` using the same source reference shape.
`moveBefore` carries `owner`/`before`; `moveToEnd` and `retire` carry `owner`.
The entire operation order validates against live and candidate ownership before
the first native mutation. Version 1's original `writes` array spelling remains
an alias; specifying both array names refuses as a duplicate field.

Optional `templates` declares immutable source templates in the same packet:

```json
{
  "key": "counter:label",
  "nodes": [
    { "parent": null, "node": { "kind": "text", "value": "Count: 0" } }
  ]
}
```

Source nodes use `kind` element/text/comment. Elements contain a qualified `name`
and an `attributes` array of qualified name/string value pairs; text/comments
contain a string `value`. The existing native template validator checks topology,
names and duplicate attributes. Mount operations can reference declarations in
their own packet or accepted declarations from earlier sequences.

The session stores accepted templates by key, so additional instances mount without
resending source payloads. Declaring an existing or duplicate candidate key refuses;
changed compiled content needs a new template key. Refusal publishes neither scene
changes nor template declarations. Accepted templates live until session disposal,
including after all of their instances retire. Reload/cache lifetime remains a
dev-workflow gate; no unbounded-refresh performance result is claimed.

Successful application returns the serializable acknowledgment
`{"version":1,"sequence":1,"status":"accepted"}`. Sequences begin at 1 and
advance only after complete application. Refusal leaves the expected sequence
available for correction; duplicate and future sequences refuse without applying
work. Empty publications advance ordering without a redraw. The acknowledgment
establishes structural acceptance, not completed layout or paint.

Unknown fields/operations, duplicate fields, missing required fields and invalid
JSON refuse. Limits are 1 MiB of UTF-8 packet bytes, 4,096 operations and 256 UTF-8
bytes per owner ID. Sequence/generation counters must be positive JavaScript safe
integers, and source indices must fit unsigned 32-bit integers. The last safe
sequence accepts once; further publication requires a new connection/document.

An ambiguous live failure closes the session and returns `AcceptanceUnknown`;
subsequent packets refuse. A process driver must also call `close()` after a lost
acknowledgment rather than replaying possibly applied work. This batch implements
the codec/session contract, not an OS process or pending-job queue.

## Process stream framing

`FrameReader` and `FrameWriter` use a four-byte unsigned big-endian length followed
by that many UTF-8 JSON bytes. Payload length is 1 through 1,048,576 bytes; the
prefix is separate. The reader checks the untrusted length before allocating a
payload. It handles split reads and interruptions; incomplete headers/payloads,
invalid lengths and I/O errors terminate the stream. Clean EOF is accepted only
between frames. A failed stream does not try to find another boundary.

The writer bounds JSON serialization in memory before emitting a prefix. Local
encoding/size errors emit no bytes. Once prefix/payload I/O begins, any write or
flush failure closes the writer. The JSON codec independently checks the payload
limit after framing.

`PublicationSession::publish_to` applies a packet and writes one structural
acceptance frame. A known-closed reply stream refuses before native application.
Failure sending acceptance returns `AcknowledgmentFailed`, closes the session and
prevents replay: applied native state may remain, while the sender's acceptance is
unknown. Ordinary packet refusal does not send an acceptance frame; the future
process driver still must send explicit refusal diagnostics and fail pending jobs.

These blocking `Read`/`Write` adapters serve transport workers or a headless host.
The UI driver must use nonblocking inbound/outbound queues and propagate worker
failure to the session. No blocking pipe wait belongs on the UI thread. Actual
process launching, queue bounds/event-loop integration and pending-job teardown
remain implementation gates; these native contracts use controlled streams.

## Combined native transactions

`NativeDocument::transact` accepts an authored sequence of `Operation` records:
mount, write, move-before, move-to-end and retire. It validates the entire sequence
before applying the first operation. A new mount may supply element/comment
destinations and text/attribute sources to later operations in the same batch.

Validation stages only new/retired owners, changed generation marks and candidate
mount containment edges. Existing sources and descendant boundaries are read from
the actual Blitz tree. It does not clone the accepted registry or maintain another
rendered tree. Same-destination moves preserve containment; cross-destination moves
refuse. Retirement invalidates existing and candidate descendants, including empty
and comment-anchored fragments. A replacement generation mounted outside a retired
parent survives that parent's retirement.

An invalid later operation leaves every earlier candidate mount/write/move/retire
unapplied, without consuming generations or requesting redraw. After validation,
the batch reuses the existing native operations under exclusive document ownership.
Adjacent writes share one mutator and retain authored order. An unexpected error
during application is terminal, including an inner error that would be an ordinary
refusal outside a prepared batch; no partial application is reported as rollback.

Structural operations currently use their established individual mutators. Redraw
requests and resource-provider work still need the controlled provider boundary;
this API is not proof of coalesced outward work for a mixed batch. The wire session
uses this same transaction path, with no second topology validator.

## Current boundary

The in-process document API, wire write-set codec/session and headless native
contracts are the current scope. Combined native transaction validation/application
and structural wire publication are implemented in process, with bounded framing
and acceptance-send failure handling. Process launch/UI queues, controlled resource
providers and full transport
failure propagation remain M2 work. Window painting and
ordinary TSX mounting follow in M3; input ordering/cancellation follows in M4.

Blitz creates a text input's editor during layout construction. Tests verify both
pre-layout value initialization and later editor updates through the engine.
Attribute writes alone are not a proof of browser input parity: live/default value
distinctions, user edits, composition and stale controlled writes need the M4
contracts before the JavaScript control adapter is claimed compatible.

Read the canonical [research](../../wiki/blitz/research.md),
[plan](../../wiki/blitz/plan.md), and [completed milestones](../../wiki/blitz/milestones.md).
