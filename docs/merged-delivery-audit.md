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
