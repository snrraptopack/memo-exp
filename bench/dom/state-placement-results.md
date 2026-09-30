# DOM benchmark: module state and component state

Measured 2026-09-30T16:29:02.177Z. Milliseconds, median of 7 samples.

Synchronous scheduler. DOM validation runs after every operation outside timing.

## Module state

| Operation | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|
| create 1k | 11.60 | 19.10 | 6.50 |
| create 10k | 116.60 | 226.10 | 70.40 |
| replace 1k | 16.50 | 27.40 | 7.40 |
| update 1k | 2.80 | 3.00 | 0.30 |
| select 1k | 2.10 | 2.30 | 0.20 |
| transition 1k | 0.70 | 1.60 | 0.20 |
| swap 1k | 2.30 | 3.00 | 0.00 |
| remove 1k | 1.40 | 2.10 | 0.10 |
| clear 1k | 3.20 | 7.30 | 0.40 |
| replace 10k | 102.50 | 226.20 | 63.30 |
| update 10k | 10.70 | 21.70 | 2.10 |
| select 10k | 11.10 | 22.10 | 0.70 |
| transition 10k | 7.50 | 19.60 | 0.10 |
| swap 10k | 22.20 | 34.80 | 0.10 |
| remove 10k | 11.20 | 12.10 | 0.00 |
| clear 10k | 15.50 | 66.00 | 3.40 |
| append1k 10k | 20.00 | 30.90 | 7.10 |
| prepend1k 10k | 25.20 | 35.30 | 5.60 |
| pop1k 10k | 17.40 | 18.00 | 1.80 |
| reverse 10k | 43.30 | 45.00 | 27.70 |
| remove100 10k | 12.00 | 11.60 | 0.50 |

## Component state

| Operation | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|
| create 1k | 11.00 | 16.50 | 6.50 |
| create 10k | 92.80 | 185.60 | 70.40 |
| replace 1k | 15.00 | 27.70 | 7.40 |
| update 1k | 0.70 | 0.50 | 0.30 |
| select 1k | 1.50 | 0.30 | 0.20 |
| transition 1k | 1.10 | 0.20 | 0.20 |
| swap 1k | 4.90 | 8.10 | 0.00 |
| remove 1k | 3.00 | 1.50 | 0.10 |
| clear 1k | 3.40 | 4.00 | 0.40 |
| replace 10k | 125.70 | 205.40 | 63.30 |
| update 10k | 4.20 | 4.10 | 2.10 |
| select 10k | 10.60 | 0.80 | 0.70 |
| transition 10k | 7.90 | 0.20 | 0.10 |
| swap 10k | 48.10 | 92.20 | 0.10 |
| remove 10k | 12.80 | 11.20 | 0.00 |
| clear 10k | 24.60 | 32.30 | 3.40 |
| append1k 10k | 27.40 | 32.70 | 7.10 |
| prepend1k 10k | 39.10 | 37.20 | 5.60 |
| pop1k 10k | 14.50 | 20.00 | 1.80 |
| reverse 10k | 46.80 | 47.80 | 27.70 |
| remove100 10k | 11.80 | 11.80 | 0.50 |

## Mixed state: module data, component selection

| Operation | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|
| create 1k | 10.70 | 16.20 | 6.50 |
| create 10k | 96.90 | 186.30 | 70.40 |
| replace 1k | 13.40 | 24.80 | 7.40 |
| update 1k | 1.80 | 3.60 | 0.30 |
| select 1k | 3.30 | 1.30 | 0.20 |
| transition 1k | 1.60 | 1.00 | 0.20 |
| swap 1k | 2.10 | 4.40 | 0.00 |
| remove 1k | 2.50 | 1.60 | 0.10 |
| clear 1k | 3.70 | 3.70 | 0.40 |
| replace 10k | 100.40 | 223.10 | 63.30 |
| update 10k | 11.80 | 24.00 | 2.10 |
| select 10k | 18.50 | 9.70 | 0.70 |
| transition 10k | 15.80 | 8.40 | 0.10 |
| swap 10k | 21.10 | 50.10 | 0.10 |
| remove 10k | 11.30 | 12.00 | 0.00 |
| clear 10k | 15.80 | 27.30 | 3.40 |
| append1k 10k | 25.80 | 30.80 | 7.10 |
| prepend1k 10k | 32.40 | 37.40 | 5.60 |
| pop1k 10k | 16.10 | 22.00 | 1.80 |
| reverse 10k | 44.30 | 45.10 | 27.70 |
| remove100 10k | 11.50 | 12.30 | 0.50 |

## Mixed state: component data, module selection

| Operation | Component rows | Inline rows | Vanilla |
|---|---:|---:|---:|
| create 1k | 11.00 | 20.50 | 6.50 |
| create 10k | 96.80 | 277.30 | 70.40 |
| replace 1k | 17.20 | 28.10 | 7.40 |
| update 1k | 0.70 | 0.50 | 0.30 |
| select 1k | 1.20 | 1.60 | 0.20 |
| transition 1k | 0.90 | 2.30 | 0.20 |
| swap 1k | 6.60 | 7.70 | 0.00 |
| remove 1k | 1.50 | 1.40 | 0.10 |
| clear 1k | 3.20 | 4.50 | 0.40 |
| replace 10k | 99.10 | 329.40 | 63.30 |
| update 10k | 2.80 | 3.20 | 2.10 |
| select 10k | 8.10 | 20.10 | 0.70 |
| transition 10k | 9.30 | 17.90 | 0.10 |
| swap 10k | 43.50 | 70.90 | 0.10 |
| remove 10k | 9.00 | 9.30 | 0.00 |
| clear 10k | 19.30 | 33.40 | 3.40 |
| append1k 10k | 17.00 | 25.30 | 7.10 |
| prepend1k 10k | 27.70 | 37.90 | 5.60 |
| pop1k 10k | 11.30 | 16.50 | 1.80 |
| reverse 10k | 41.90 | 44.90 | 27.70 |
| remove100 10k | 10.30 | 10.80 | 0.50 |

The mixed placements separate data location from selection location. Component-owned selection uses a prop and owner callback for component rows. These timings include those authored paths; vanilla uses direct node references. Small timings approach timer resolution, and a single run does not establish a universal ranking.
