# Isolated routing-kernel benchmark

| Topology | Kernel | Construct (ms) | Mount (ns/entity) | Unmount (ns/entity) | Route median (ns) | Alloc. objects/route | Retained units |
|---|---|---:|---:|---:|---:|---:|---:|
| exact-low-fanout | static-index | 1.308 | 1267.7 | 3140.0 | 11169.4 | 9.0 | 257 |
| exact-low-fanout | dynamic-subscription | 0.227 | 1422.2 | 4240.0 | 3718.8 | 9.0 | 257 |
| exact-high-fanout | static-index | 5.353 | 527.6 | 2192.0 | 87376.2 | 9.0 | 8193 |
| exact-high-fanout | dynamic-subscription | 0.042 | 9712.5 | 18584.0 | 82786.5 | 9.0 | 8193 |
| wildcard-heavy | static-index | 2.391 | 70479.0 | 24364.0 | 43950.1 | 9.0 | 4193 |
| wildcard-heavy | dynamic-subscription | 0.072 | 3350.6 | 4440.0 | 26847.5 | 9.0 | 4097 |
| batched-writes | static-index | 0.635 | 18762.3 | 5460.0 | 55845.3 | 9.0 | 2081 |
| batched-writes | dynamic-subscription | 0.070 | 1294.9 | 1272.0 | 41731.3 | 9.0 | 2049 |
| derived-depth-4 | static-index | 0.755 | 30416.9 | 9230.8 | 37537.1 | 18.0 | 2084 |
| derived-depth-4 | dynamic-subscription | 0.073 | 2504.2 | 2738.5 | 24117.3 | 18.0 | 2052 |
| large-topology | static-index | 4.967 | 217941.8 | 71382.4 | 111402.9 | 12.0 | 16642 |
| large-topology | dynamic-subscription | 0.224 | 5976.4 | 6806.9 | 93192.2 | 12.0 | 16386 |

Construction and routing times are medians of nine in-process samples after warm-up; lifecycle times are medians of seven fresh-kernel samples. The dynamic baseline is a purpose-built key-to-subscriber Set, not Solid or Vue. No DOM, rendering, or framework scheduler is included. Allocation objects are a structural lower bound and retained representation units are exact logical counts, avoiding VM-specific heap-sampling noise.
