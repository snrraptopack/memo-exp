# Replicated isolated routing benchmark

Each cell is the median of 3 fresh processes; brackets show the process minimum and maximum.

| Topology | Static route ns [range] | Dynamic route ns [range] | Static/dynamic | Static mount ns/entity | Dynamic mount ns/entity |
|---|---:|---:|---:|---:|---:|
| exact-low-fanout | 7452.1 [5919.9, 10337.7] | 3971.4 [3916.9, 4508.5] | 1.88x | 575.5 | 1109.7 |
| exact-high-fanout | 73045.8 [59451.1, 73546.8] | 79609.1 [63970.5, 92187.5] | 0.92x | 360.3 | 9755.6 |
| wildcard-heavy | 32848.6 [32325.2, 52210.1] | 26005.8 [25483.1, 27386.0] | 1.26x | 127540.5 | 3721.8 |
| batched-writes | 69240.7 [68871.5, 73891.2] | 45324.3 [42516.5, 46360.7] | 1.53x | 22138.1 | 1516.0 |
| derived-depth-4 | 42692.6 [38199.1, 68087.7] | 31517.6 [23914.3, 32935.9] | 1.35x | 25144.6 | 1291.9 |
| large-topology | 94934.1 [91105.3, 99657.1] | 84657.6 [83758.8, 92088.8] | 1.12x | 229717.2 | 5517.7 |

The kernels are checked for identical selected entity sets before timing. These measurements isolate routing and lifecycle representation costs; they contain no DOM, rendering, or framework scheduler.
