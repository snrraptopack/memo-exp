# Pinned renderer startup patch

Upstream: `anyrender_vello` 0.15.0, published from
[`cf0f14776102ec775af61bcdcaac2ab345f4fafb`](https://github.com/dioxuslabs/anyrender/tree/cf0f14776102ec775af61bcdcaac2ab345f4fafb/crates/anyrender_vello).
The unchanged source files and normalized Cargo manifest come from that exact
registry distribution. Upstream uses MIT OR Apache-2.0; both licenses are retained.

Local changes:

- `native_init.rs` runs the GPU future on a named worker. Surface creation and
  the original, potentially non-Send completion callback stay on the UI thread.
  An embedder-owned Send wake queues UI work; `notify_initialization_ready`
  invokes the completion callback there. No unsafe Send assertion is used.
- Pending callbacks are cancelled on suspension. A late worker result cannot
  activate a newer surface. Each renderer permits at most two outstanding GPU
  jobs, covering one interrupted job and its replacement; failures wake the UI
  and report an error rather than pretending the renderer is ready.
- The window renderer compiles only its configured anti-aliasing mode. Its
  chosen quality is unchanged. Upstream compiles all modes even though this
  renderer's options fix the mode for its lifetime.
- Without an embedder startup wake, the upstream inline initialization path is
  retained. Wasm keeps upstream spawn-local initialization.

This is a presentation dependency patch, not another semantic runtime. Keep its
diff against the pinned registry source small and reassess it on upstream updates.
The architecture and measurements remain in `wiki/blitz`, not this provenance note.
