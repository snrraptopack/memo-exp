# Forms, read, and tracking

Run `bun run example:dev` and open `/data-forms-read/`.

This example combines a replayable `$read(loadMessages())`, `$track(initial)`
for refresh, schema-validated `$forms`, `$track(form)` for each submission's
success/error callbacks, and a derived `let total`. Submitting `fail` shows a
server error and rolls back the temporary message. Submitting several messages
quickly exercises overlapping operations; their delays vary with text length.
