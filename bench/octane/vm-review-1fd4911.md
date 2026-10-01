# Virtual run — DOM and pinned Octane comparison

Memoized DOM commit: `1fd4911f09aa656a3707015bec8574ef8bff50de`.

## Run status

| Step | Result |
| --- | --- |
| Production build | PASS |
| DOM suite | PASS |
| Octane setup | Pinned dependencies installed; browser CDN ZIP downloads failed |
| Browser fallback | Existing Chromium 153 via isolated Playwright executable cache |
| Octane canonical/reorder | PASS |

## Environment and method

| Item | Value |
| --- | --- |
| DOM measured at | 2026-10-01T03:15:14.972Z |
| Octane measured at | 2026-10-01T03:15:29.081Z |
| Octane source pin | 874ca5f139c6ed6f29b4970a567bc7e22b0b3ca4 |
| Upstream lockfile SHA256 | 09d38ea104f54a17b1b73518811d8ffd9e5780adfe9dc470b80a7fe9387ebbea |
| Chromium | 153.0.8010.0 |
| Playwright | 1.61.1 |
| Bun | 1.4.2 |
| Node | v24.19.0 |
| pnpm | 11.15.1 |
| CPU | AMD EPYC 9V74 80-Core Processor |
| Logical CPUs | 9 |
| CPU quota | 800000 100000 |
| Memory limit bytes | 8589934592 |
| CPU throttle | 1 |
| DOM samples | 7 per cell |
| Octane samples | 8 |
| Execution | Production builds complete before timings; DOM then canonical then reorder sequentially |

Playwright cache executable links point to existing @sparticuz/chromium Chromium 153.0.8010.0; every target uses that binary. Playwright expected Chrome 149, but CDN returned invalid ZIP files.

Pinned upstream source remains unmodified. Memoized dirty flag reflects generated benchmark result files; tracked paths are listed in run-environment.json. No compiler/runtime source was edited for this run.

Both harnesses time JavaScript and completed DOM commits, excluding completed paint and automation transport. Their DOM structure, data operations and validation differ, so compare adapters within each suite. Values near zero cannot support precise ratios. Historical DOM comparisons are separate VM runs.

## Adapter versions

| Adapter | Dependencies |
| --- | --- |
| octane-tsrx | octane@0.7.1 |

| Adapter | Dependencies |
| --- | --- |
| octane-jsx | octane@0.7.1 |

| Adapter | Dependencies |
| --- | --- |
| react | react@19.2.7, react-dom@19.2.7 |

| Adapter | Dependencies |
| --- | --- |
| ripple | ripple@0.4.0 |

| Adapter | Dependencies |
| --- | --- |
| solid | solid-js@2.0.0-beta.20, @solidjs/web@2.0.0-beta.20 |

| Adapter | Dependencies |
| --- | --- |
| vue-vapor | vue@3.6.0-rc.1, @vue/runtime-dom@3.6.0-rc.1, @vue/runtime-vapor@3.6.0-rc.1 |

| Adapter | Dependencies |
| --- | --- |
| preact | preact@10.29.8 |

| Adapter | Dependencies |
| --- | --- |
| svelte | svelte@5.56.7 |

| Adapter | Dependencies |
| --- | --- |
| inferno | inferno@9.1.0 |

| Adapter | Dependencies |
| --- | --- |
| memoized-dom | @memoized-dom/runtime@0.0.9 |

## DOM placement suite

Synchronous scheduler, seven samples, correctness after each timed sample; retained row identity and mixed selection/reverse/remove/append sequences passed.

### Both states module

Median milliseconds.

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.70 | 1.60 | 1.00 |
| create 10k | 15.30 | 13.70 | 9.50 |
| replace 1k | 1.90 | 1.70 | 0.90 |
| update 1k | 0.20 | 0.20 | 0.00 |
| select 1k | 0.00 | 0.10 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.20 | 0.20 | 0.00 |
| remove 1k | 0.10 | 0.20 | 0.00 |
| clear 1k | 0.60 | 0.50 | 0.10 |
| replace 10k | 15.30 | 19.40 | 8.80 |
| update 10k | 1.80 | 1.60 | 0.50 |
| select 10k | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.00 | 0.10 |
| swap 10k | 2.20 | 2.10 | 0.00 |
| remove 10k | 1.60 | 1.40 | 0.00 |
| clear 10k | 2.30 | 2.40 | 0.60 |
| append1k 10k | 3.00 | 2.40 | 0.80 |
| prepend1k 10k | 3.70 | 3.20 | 1.00 |
| pop1k 10k | 2.00 | 1.40 | 0.30 |
| reverse 10k | 6.60 | 6.10 | 4.60 |
| remove100 10k | 1.90 | 1.50 | 0.10 |

### Both states component

Median milliseconds.

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.70 | 1.60 | 1.00 |
| create 10k | 13.90 | 16.70 | 9.50 |
| replace 1k | 1.80 | 2.00 | 0.90 |
| update 1k | 0.20 | 0.20 | 0.00 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.20 | 0.20 | 0.00 |
| remove 1k | 0.10 | 0.10 | 0.00 |
| clear 1k | 0.50 | 0.50 | 0.10 |
| replace 10k | 16.90 | 15.80 | 8.80 |
| update 10k | 2.40 | 1.80 | 0.50 |
| select 10k | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.00 | 0.10 |
| swap 10k | 2.30 | 1.80 | 0.00 |
| remove 10k | 1.60 | 1.20 | 0.00 |
| clear 10k | 2.50 | 2.50 | 0.60 |
| append1k 10k | 3.00 | 2.50 | 0.80 |
| prepend1k 10k | 5.90 | 3.10 | 1.00 |
| pop1k 10k | 2.00 | 1.30 | 0.30 |
| reverse 10k | 7.50 | 6.20 | 4.60 |
| remove100 10k | 2.20 | 1.50 | 0.10 |

### Module data, component selection

Median milliseconds.

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.60 | 1.50 | 1.00 |
| create 10k | 14.40 | 13.50 | 9.50 |
| replace 1k | 1.70 | 1.70 | 0.90 |
| update 1k | 0.20 | 0.10 | 0.00 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.20 | 0.20 | 0.00 |
| remove 1k | 0.20 | 0.20 | 0.00 |
| clear 1k | 0.50 | 0.50 | 0.10 |
| replace 10k | 17.50 | 16.80 | 8.80 |
| update 10k | 2.10 | 1.70 | 0.50 |
| select 10k | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.10 | 0.00 | 0.10 |
| swap 10k | 2.40 | 1.80 | 0.00 |
| remove 10k | 1.50 | 1.40 | 0.00 |
| clear 10k | 2.50 | 2.40 | 0.60 |
| append1k 10k | 3.20 | 2.40 | 0.80 |
| prepend1k 10k | 3.70 | 3.10 | 1.00 |
| pop1k 10k | 1.60 | 1.50 | 0.30 |
| reverse 10k | 6.60 | 6.90 | 4.60 |
| remove100 10k | 2.50 | 1.60 | 0.10 |

### Component data, module selection

Median milliseconds.

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.50 | 1.50 | 1.00 |
| create 10k | 13.30 | 13.50 | 9.50 |
| replace 1k | 1.90 | 1.90 | 0.90 |
| update 1k | 0.20 | 0.10 | 0.00 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.20 | 0.00 |
| remove 1k | 0.20 | 0.20 | 0.00 |
| clear 1k | 0.50 | 0.50 | 0.10 |
| replace 10k | 14.90 | 16.40 | 8.80 |
| update 10k | 1.80 | 1.40 | 0.50 |
| select 10k | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.00 | 0.10 |
| swap 10k | 2.30 | 1.90 | 0.00 |
| remove 10k | 1.70 | 1.40 | 0.00 |
| clear 10k | 2.60 | 2.70 | 0.60 |
| append1k 10k | 2.40 | 2.30 | 0.80 |
| prepend1k 10k | 3.40 | 3.10 | 1.00 |
| pop1k 10k | 1.70 | 1.40 | 0.30 |
| reverse 10k | 6.60 | 6.00 | 4.60 |
| remove100 10k | 1.90 | 1.60 | 0.10 |

## DOM comparison with corrected 9811e0c baseline

Separate historical runs; differences include VM noise. Median milliseconds.

### Both states module

| Operation | Previous component | New component | Previous inline | New inline |
| --- | --- | --- | --- | --- |
| create 1k | 1.70 | 1.70 | 1.40 | 1.60 |
| create 10k | 14.90 | 15.30 | 14.10 | 13.70 |
| replace 1k | 2.00 | 1.90 | 1.90 | 1.70 |
| update 1k | 0.30 | 0.20 | 0.20 | 0.20 |
| select 1k | 0.00 | 0.00 | 0.00 | 0.10 |
| transition 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.20 | 0.30 | 0.20 |
| remove 1k | 0.20 | 0.10 | 0.20 | 0.20 |
| clear 1k | 0.50 | 0.60 | 0.60 | 0.50 |
| replace 10k | 19.00 | 15.30 | 19.20 | 19.40 |
| update 10k | 3.10 | 1.80 | 2.50 | 1.60 |
| select 10k | 0.20 | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.00 | 0.10 | 0.00 |
| swap 10k | 3.50 | 2.20 | 3.30 | 2.10 |
| remove 10k | 2.40 | 1.60 | 2.30 | 1.40 |
| clear 10k | 2.60 | 2.30 | 2.50 | 2.40 |
| append1k 10k | 3.50 | 3.00 | 3.60 | 2.40 |
| prepend1k 10k | 4.80 | 3.70 | 4.50 | 3.20 |
| pop1k 10k | 2.40 | 2.00 | 2.50 | 1.40 |
| reverse 10k | 7.90 | 6.60 | 7.90 | 6.10 |
| remove100 10k | 2.40 | 1.90 | 2.60 | 1.50 |

### Both states component

| Operation | Previous component | New component | Previous inline | New inline |
| --- | --- | --- | --- | --- |
| create 1k | 1.60 | 1.70 | 1.30 | 1.60 |
| create 10k | 14.50 | 13.90 | 12.40 | 16.70 |
| replace 1k | 2.00 | 1.80 | 1.80 | 2.00 |
| update 1k | 0.30 | 0.20 | 0.30 | 0.20 |
| select 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.40 | 0.20 | 0.30 | 0.20 |
| remove 1k | 0.20 | 0.10 | 0.20 | 0.10 |
| clear 1k | 0.60 | 0.50 | 0.40 | 0.50 |
| replace 10k | 18.00 | 16.90 | 15.80 | 15.80 |
| update 10k | 3.10 | 2.40 | 2.10 | 1.80 |
| select 10k | 0.10 | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.10 | 0.00 | 0.00 | 0.00 |
| swap 10k | 3.50 | 2.30 | 3.10 | 1.80 |
| remove 10k | 2.90 | 1.60 | 2.10 | 1.20 |
| clear 10k | 2.80 | 2.50 | 2.40 | 2.50 |
| append1k 10k | 4.00 | 3.00 | 3.20 | 2.50 |
| prepend1k 10k | 5.30 | 5.90 | 4.30 | 3.10 |
| pop1k 10k | 3.10 | 2.00 | 2.40 | 1.30 |
| reverse 10k | 9.60 | 7.50 | 7.70 | 6.20 |
| remove100 10k | 2.90 | 2.20 | 2.30 | 1.50 |

### Module data, component selection

| Operation | Previous component | New component | Previous inline | New inline |
| --- | --- | --- | --- | --- |
| create 1k | 1.60 | 1.60 | 1.60 | 1.50 |
| create 10k | 15.90 | 14.40 | 13.30 | 13.50 |
| replace 1k | 1.90 | 1.70 | 1.90 | 1.70 |
| update 1k | 0.20 | 0.20 | 0.20 | 0.10 |
| select 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.20 | 0.40 | 0.20 |
| remove 1k | 0.30 | 0.20 | 0.20 | 0.20 |
| clear 1k | 0.50 | 0.50 | 0.40 | 0.50 |
| replace 10k | 17.70 | 17.50 | 19.20 | 16.80 |
| update 10k | 3.40 | 2.10 | 2.40 | 1.70 |
| select 10k | 0.20 | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.10 | 0.10 | 0.00 | 0.00 |
| swap 10k | 3.90 | 2.40 | 3.30 | 1.80 |
| remove 10k | 3.30 | 1.50 | 2.10 | 1.40 |
| clear 10k | 2.40 | 2.50 | 2.50 | 2.40 |
| append1k 10k | 3.80 | 3.20 | 3.30 | 2.40 |
| prepend1k 10k | 4.90 | 3.70 | 4.30 | 3.10 |
| pop1k 10k | 3.10 | 1.60 | 2.30 | 1.50 |
| reverse 10k | 8.60 | 6.60 | 9.60 | 6.90 |
| remove100 10k | 3.40 | 2.50 | 2.10 | 1.60 |

### Component data, module selection

| Operation | Previous component | New component | Previous inline | New inline |
| --- | --- | --- | --- | --- |
| create 1k | 1.50 | 1.50 | 1.70 | 1.50 |
| create 10k | 16.50 | 13.30 | 13.70 | 13.50 |
| replace 1k | 2.00 | 1.90 | 2.00 | 1.90 |
| update 1k | 0.40 | 0.20 | 0.20 | 0.10 |
| select 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.30 | 0.30 | 0.20 |
| remove 1k | 0.30 | 0.20 | 0.30 | 0.20 |
| clear 1k | 0.50 | 0.50 | 0.60 | 0.50 |
| replace 10k | 17.80 | 14.90 | 17.30 | 16.40 |
| update 10k | 3.10 | 1.80 | 2.70 | 1.40 |
| select 10k | 0.10 | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.00 | 0.00 | 0.00 |
| swap 10k | 3.60 | 2.30 | 3.40 | 1.90 |
| remove 10k | 2.90 | 1.70 | 2.60 | 1.40 |
| clear 10k | 2.80 | 2.60 | 2.40 | 2.70 |
| append1k 10k | 4.00 | 2.40 | 3.50 | 2.30 |
| prepend1k 10k | 4.70 | 3.40 | 5.00 | 3.10 |
| pop1k 10k | 3.00 | 1.70 | 2.40 | 1.40 |
| reverse 10k | 8.10 | 6.60 | 8.10 | 6.00 |
| remove100 10k | 3.00 | 1.90 | 2.60 | 1.60 |

## Pinned Octane suite

Default ten targets, eight samples per cell. Canonical: three initial warmups. Reorder: two warmups per operation; repeated-operation batches are divided by their repetition count. Every table is median milliseconds per operation. Canonical validates commit outcomes immediately after timing; reorder performs untimed order and retained identity gates. Octane-only work/call/scratch gates are additional checks, not equal-work gates for every framework. Sample counts, minimums, dispersion summaries and deterministic work metrics remain in the upstream JSON. The pinned harness persists summary statistics rather than every individual timing sample.

### js-framework

Samples: 8. Status: PASS

| Operation | octane-tsrx | octane-jsx | react | ripple | solid |
| --- | --- | --- | --- | --- | --- |
| run | 4.900 | 5.700 | 10.800 | 4.500 | 4.800 |
| replace | 10.500 | 12.400 | 21.700 | 9.000 | 12.500 |
| add | 5.500 | 5.600 | 11.600 | 4.000 | 4.300 |
| update | 0.800 | 0.900 | 1.300 | 0.500 | 1.700 |
| select | 0.200 | 0.500 | 0.600 | 0.200 | 0.400 |
| swap | 0.600 | 1.000 | 8.500 | 0.300 | 0.500 |
| remove | 0.500 | 0.900 | 1.100 | 0.300 | 0.400 |
| runlots | 55.000 | 47.000 | 231.200 | 38.300 | 37.200 |
| select_lots | 0.300 | 4.400 | 2.000 | 0.200 | 2.400 |
| clear | 54.000 | 56.400 | 105.100 | 49.600 | 59.300 |

| Operation | vue-vapor | preact | svelte | inferno | memoized-dom |
| --- | --- | --- | --- | --- | --- |
| run | 5.100 | 13.300 | 6.900 | 5.900 | 5.000 |
| replace | 11.200 | 23.600 | 12.700 | 11.200 | 10.700 |
| add | 4.900 | 14.900 | 6.800 | 5.400 | 5.000 |
| update | 0.700 | 1.900 | 0.900 | 0.800 | 0.500 |
| select | 0.200 | 0.800 | 1.600 | 0.300 | 0.200 |
| swap | 0.500 | 1.000 | 0.600 | 0.700 | 0.800 |
| remove | 0.400 | 1.000 | 0.700 | 0.500 | 0.800 |
| runlots | 44.300 | 154.200 | 61.900 | 54.800 | 47.900 |
| select_lots | 0.200 | 3.400 | 10.800 | 1.400 | 0.100 |
| clear | 50.100 | 89.000 | 59.300 | 60.100 | 55.500 |

### keyed-reorder-matrix

Samples: 8. Status: PASS

| Operation | octane-tsrx | octane-jsx | react | ripple | solid |
| --- | --- | --- | --- | --- | --- |
| reverse | 2.275 | 3.150 | 4.850 | 2.425 | 2.500 |
| shuffle | 2.875 | 3.800 | 4.850 | 2.375 | 2.600 |
| rotatef | 0.144 | 0.497 | 3.027 | 0.062 | 0.160 |
| rotateb | 0.138 | 0.491 | 0.241 | 0.036 | 0.135 |
| prepend100 | 1.200 | 1.200 | 2.000 | 0.700 | 0.800 |
| append100 | 1.300 | 1.200 | 1.600 | 0.600 | 0.800 |
| insertmid100 | 1.200 | 1.300 | 2.100 | 0.600 | 0.700 |
| removefirst | 0.090 | 0.380 | 0.265 | 0.045 | 0.105 |
| removeevery10 | 0.375 | 0.550 | 0.610 | 0.305 | 0.375 |
| displace3 | 0.160 | 0.555 | 0.330 | 0.110 | 0.270 |
| displace4 | 0.180 | 0.550 | 0.300 | 0.115 | 0.220 |
| displace5 | 0.165 | 0.535 | 0.290 | 0.125 | 0.225 |
| displace6 | 0.190 | 0.540 | 0.315 | 0.125 | 0.250 |
| displace8 | 0.205 | 0.700 | 0.355 | 0.155 | 0.240 |

| Operation | vue-vapor | preact | svelte | inferno | memoized-dom |
| --- | --- | --- | --- | --- | --- |
| reverse | 3.250 | 5.575 | 25.625 | 2.825 | 3.175 |
| shuffle | 3.925 | 5.325 | 3.550 | 3.000 | 3.225 |
| rotatef | 1.442 | 0.274 | 0.198 | 0.227 | 0.227 |
| rotateb | 0.285 | 0.268 | 0.119 | 0.255 | 0.229 |
| prepend100 | 0.800 | 2.900 | 1.500 | 1.000 | 0.900 |
| append100 | 0.700 | 3.000 | 1.400 | 1.000 | 0.800 |
| insertmid100 | 0.700 | 3.700 | 1.200 | 1.000 | 1.000 |
| removefirst | 0.070 | 0.330 | 0.165 | 0.140 | 0.290 |
| removeevery10 | 0.520 | 0.650 | 0.355 | 0.595 | 0.410 |
| displace3 | 0.570 | 3.145 | 0.175 | 0.300 | 0.235 |
| displace4 | 0.465 | 3.320 | 0.155 | 0.305 | 0.255 |
| displace5 | 0.465 | 3.025 | 0.150 | 0.285 | 0.230 |
| displace6 | 0.480 | 3.485 | 0.175 | 0.295 | 0.225 |
| displace8 | 0.495 | 3.520 | 0.185 | 0.340 | 0.245 |

- octane-tsrx: {"identityGate": "pass", "scratchGate": "pass", "phases": [{"button": "reverse", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "rotateb", "rows": 1000, "repetitions": 8, "allocations": 0, "bytes": 0}, {"button": "rotatef", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "shuffle", "rows": 1000, "repetitions": 3, "allocations": 0, "bytes": 0}, {"button": "swaprows", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "reverse", "rows": 10000, "repetitions": 2, "allocations": 0, "bytes": 0}, {"button": "rotateb", "rows": 10000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "shuffle", "rows": 10000, "repetitions": 2, "allocations": 0, "bytes": 0}, {"button": "swaprows", "rows": 10000, "repetitions": 2, "allocations": 0, "bytes": 0}, {"button": "rotateb", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}], "observedAllocations": 6, "retainedScratchBytes": 80000}

- octane-jsx: {"identityGate": "pass", "scratchGate": "pass", "phases": [{"button": "reverse", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "rotateb", "rows": 1000, "repetitions": 8, "allocations": 0, "bytes": 0}, {"button": "rotatef", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "shuffle", "rows": 1000, "repetitions": 3, "allocations": 0, "bytes": 0}, {"button": "swaprows", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "reverse", "rows": 10000, "repetitions": 2, "allocations": 0, "bytes": 0}, {"button": "rotateb", "rows": 10000, "repetitions": 4, "allocations": 0, "bytes": 0}, {"button": "shuffle", "rows": 10000, "repetitions": 2, "allocations": 0, "bytes": 0}, {"button": "swaprows", "rows": 10000, "repetitions": 2, "allocations": 0, "bytes": 0}, {"button": "rotateb", "rows": 1000, "repetitions": 4, "allocations": 0, "bytes": 0}], "observedAllocations": 6, "retainedScratchBytes": 80000}

- react: {"identityGate": "pass"}

- ripple: {"identityGate": "pass"}

- solid: {"identityGate": "pass"}

- vue-vapor: {"identityGate": "pass"}

- preact: {"identityGate": "pass"}

- svelte: {"identityGate": "pass"}

- inferno: {"identityGate": "pass"}

- memoized-dom: {"identityGate": "pass"}

## Findings

DOM: selection remains near timer resolution across placements. Partial updates and several broad replay operations measured lower than the corrected 9811e0c run. Creation is mixed. These historical runs do not isolate the text-cache change.

Octane canonical: memoized-dom is competitive in creation and partial updates, with fast large-list selection. Ripple leads several operations; Solid here is 2.0.0-beta.20 and Vue Vapor is 3.6.0-rc.1, unlike the earlier framework suite.

Octane reorder: memoized-dom passes every identity gate but does not lead the suite. Its removal-first, reverse/shuffle and rotation results reveal costs that the simple selection workload does not exercise. Svelte reverse is an outlier in this run; no cause or universal ranking is established.

## Reproduction

```sh
bun run build
PUPPETEER_EXECUTABLE_PATH=/path/to/chromium bun run bench
bun run bench:octane:setup
# VM browser download failed; use the recorded executable cache substitution:
PLAYWRIGHT_BROWSERS_PATH=/path/to/isolated/playwright-cache bun run bench:octane
```

Default upstream harnesses were used without source edits. Setup error details are in setup.log. Full upstream result summaries are in octane-results.md and octane-results.json.
