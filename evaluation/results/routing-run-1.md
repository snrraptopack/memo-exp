# Isolated routing-kernel benchmark

| Topology | Kernel | Construct (ms) | Mount (ns/entity) | Unmount (ns/entity) | Route median (ns) | Alloc. objects/route | Retained units |
|---|---|---:|---:|---:|---:|---:|---:|
| exact-low-fanout | static-index | 0.465 | 575.5 | 2708.0 | 5919.9 | 9.0 | 257 |
| exact-low-fanout | dynamic-subscription | 0.173 | 1040.9 | 3644.0 | 3971.4 | 9.0 | 257 |
| exact-high-fanout | static-index | 4.289 | 339.7 | 960.0 | 59451.1 | 9.0 | 8193 |
| exact-high-fanout | dynamic-subscription | 0.048 | 7582.1 | 12544.0 | 63970.5 | 9.0 | 8193 |
| wildcard-heavy | static-index | 1.905 | 86005.4 | 31348.0 | 32325.2 | 9.0 | 4193 |
| wildcard-heavy | dynamic-subscription | 0.071 | 3248.6 | 6800.0 | 25483.1 | 9.0 | 4097 |
| batched-writes | static-index | 1.195 | 22138.1 | 5568.0 | 73891.2 | 9.0 | 2081 |
| batched-writes | dynamic-subscription | 0.058 | 1214.8 | 1184.0 | 42516.5 | 9.0 | 2049 |
| derived-depth-4 | static-index | 1.994 | 38346.5 | 9007.7 | 68087.7 | 18.0 | 2084 |
| derived-depth-4 | dynamic-subscription | 0.073 | 1166.2 | 1242.3 | 23914.3 | 18.0 | 2052 |
| large-topology | static-index | 4.745 | 219216.0 | 94118.6 | 91105.3 | 12.0 | 16642 |
| large-topology | dynamic-subscription | 0.211 | 4634.6 | 4526.5 | 84657.6 | 12.0 | 16386 |

Construction and routing times are medians of nine in-process samples after warm-up; lifecycle times are medians of seven fresh-kernel samples. The dynamic baseline is a purpose-built key-to-subscriber Set, not Solid or Vue. No DOM, rendering, or framework scheduler is included. Allocation objects are a structural lower bound and retained representation units are exact logical counts, avoiding VM-specific heap-sampling noise.
