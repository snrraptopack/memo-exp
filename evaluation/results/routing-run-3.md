# Isolated routing-kernel benchmark

| Topology | Kernel | Construct (ms) | Mount (ns/entity) | Unmount (ns/entity) | Route median (ns) | Alloc. objects/route | Retained units |
|---|---|---:|---:|---:|---:|---:|---:|
| exact-low-fanout | static-index | 0.479 | 601.6 | 3492.0 | 10337.7 | 9.0 | 257 |
| exact-low-fanout | dynamic-subscription | 0.134 | 1329.6 | 1784.0 | 4508.5 | 9.0 | 257 |
| exact-high-fanout | static-index | 5.640 | 595.3 | 1188.0 | 73546.8 | 9.0 | 8193 |
| exact-high-fanout | dynamic-subscription | 0.045 | 16387.9 | 27840.0 | 79609.1 | 9.0 | 8193 |
| wildcard-heavy | static-index | 1.667 | 127540.5 | 37740.0 | 32848.6 | 9.0 | 4193 |
| wildcard-heavy | dynamic-subscription | 0.085 | 3721.8 | 5132.0 | 26005.8 | 9.0 | 4097 |
| batched-writes | static-index | 0.723 | 20994.2 | 6156.0 | 68871.5 | 9.0 | 2081 |
| batched-writes | dynamic-subscription | 0.117 | 1516.0 | 1632.0 | 46360.7 | 9.0 | 2049 |
| derived-depth-4 | static-index | 0.965 | 25144.6 | 12076.9 | 42692.6 | 18.0 | 2084 |
| derived-depth-4 | dynamic-subscription | 0.067 | 1291.9 | 1276.9 | 32935.9 | 18.0 | 2052 |
| large-topology | static-index | 7.068 | 229717.2 | 134223.5 | 99657.1 | 12.0 | 16642 |
| large-topology | dynamic-subscription | 0.240 | 5517.7 | 5158.8 | 92088.8 | 12.0 | 16386 |

Construction and routing times are medians of nine in-process samples after warm-up; lifecycle times are medians of seven fresh-kernel samples. The dynamic baseline is a purpose-built key-to-subscriber Set, not Solid or Vue. No DOM, rendering, or framework scheduler is included. Allocation objects are a structural lower bound and retained representation units are exact logical counts, avoiding VM-specific heap-sampling noise.
