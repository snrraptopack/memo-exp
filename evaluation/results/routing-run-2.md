# Isolated routing-kernel benchmark

| Topology | Kernel | Construct (ms) | Mount (ns/entity) | Unmount (ns/entity) | Route median (ns) | Alloc. objects/route | Retained units |
|---|---|---:|---:|---:|---:|---:|---:|
| exact-low-fanout | static-index | 0.480 | 493.8 | 3400.0 | 7452.1 | 9.0 | 257 |
| exact-low-fanout | dynamic-subscription | 0.088 | 1109.7 | 1060.0 | 3916.9 | 9.0 | 257 |
| exact-high-fanout | static-index | 6.275 | 360.3 | 928.0 | 73045.8 | 9.0 | 8193 |
| exact-high-fanout | dynamic-subscription | 0.052 | 9755.6 | 16392.0 | 92187.5 | 9.0 | 8193 |
| wildcard-heavy | static-index | 2.812 | 134100.8 | 28936.0 | 52210.1 | 9.0 | 4193 |
| wildcard-heavy | dynamic-subscription | 0.120 | 4458.0 | 8160.0 | 27386.0 | 9.0 | 4097 |
| batched-writes | static-index | 1.440 | 25511.7 | 10084.0 | 69240.7 | 9.0 | 2081 |
| batched-writes | dynamic-subscription | 0.086 | 2433.9 | 3332.0 | 45324.3 | 9.0 | 2049 |
| derived-depth-4 | static-index | 0.821 | 23583.5 | 6665.4 | 38199.1 | 18.0 | 2084 |
| derived-depth-4 | dynamic-subscription | 0.072 | 1801.2 | 1553.8 | 31517.6 | 18.0 | 2052 |
| large-topology | static-index | 4.968 | 303005.0 | 150334.3 | 94934.1 | 12.0 | 16642 |
| large-topology | dynamic-subscription | 0.726 | 9400.7 | 11173.5 | 83758.8 | 12.0 | 16386 |

Construction and routing times are medians of nine in-process samples after warm-up; lifecycle times are medians of seven fresh-kernel samples. The dynamic baseline is a purpose-built key-to-subscriber Set, not Solid or Vue. No DOM, rendering, or framework scheduler is included. Allocation objects are a structural lower bound and retained representation units are exact logical counts, avoiding VM-specific heap-sampling noise.
