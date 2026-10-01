# Full virtual benchmark run — 581b40f

Commit: `581b40f958eb20201ef7efc968fcf9ac26a2d46d`.

## Status and environment

| Item | Recorded value |
| --- | --- |
| Build | PASS; fresh runtime and compiler after competing process exited |
| DOM | PASS; two full runs, seven samples per cell in each |
| Octane | PASS; canonical and reorder, ten targets |
| DOM measured at | 2026-10-01T17:03:17.410Z |
| Octane measured at | 2026-10-01T17:03:17.609Z |
| Current CPU | INTEL(R) XEON(R) PLATINUM 8573C |
| Previous CPU | AMD EPYC 9V74 |
| Architecture | x86_64 |
| Visible CPUs | 9 |
| CPU quota | 800000 100000 |
| Memory limit bytes | 8589934592 |
| Chromium — DOM | HeadlessChrome/153.0.8010.0 |
| Chromium — Octane | 153.0.8010.0 |
| Browser executable | /workspace/scratch/e439c4be0487/tooling/chromium |
| Executable SHA256 | 53a15d6c3a3d27dfb54c4ba60278b1683136f70cf1e67e989da7dfbd3d451ef0 |
| Bun | 1.4.2 |
| Node | v24.19.0 |
| Playwright | 1.61.1 |
| pnpm | 11.15.1 |
| CPU throttle | 1 |
| Octane source | 874ca5f139c6ed6f29b4970a567bc7e22b0b3ca4 |
| Upstream lockfile SHA256 | 09d38ea104f54a17b1b73518811d8ffd9e5780adfe9dc470b80a7fe9387ebbea |

The current host is Intel Xeon; the earlier run was AMD EPYC. This run uses one VM, one x86-64 architecture and one Chromium executable throughout both suites. Historical runs are not controlled before/after comparisons because the CPU host changed.

Setup installed pinned dependencies. Its browser download failed; an isolated Playwright cache points both full Chromium and headless-shell executable paths to the same working Chromium 153 binary used by Puppeteer. Live launches through both APIs verified their versions. No upstream harness or framework source was modified to make that substitution.

Commands: `bun run build`, `bun run bench`, `bun run bench:octane`. No quick, smoke, target filter or canonical-only options. Setup completed before timing; DOM, Octane and the DOM stability repeat ran sequentially.

An initial attempt overlapped another benchmark and was discarded. Final runs started after that process exited. Discarded logs are labelled separately in the archive. Both suites measure JavaScript and completed DOM commits, excluding completed paint. Their markup and state operations differ, so compare frameworks within a suite. Zero values mean timer resolution, not zero work. Two full DOM executions with seven samples per cell in each, and one full Octane execution with eight samples per cell.

## Pinned runtime versions

| Adapter | Dependencies |
| --- | --- |
| octane-tsrx | octane@0.7.1 |
| octane-jsx | octane@0.7.1 |
| react | react@19.2.7, react-dom@19.2.7 |
| ripple | ripple@0.4.0 |
| solid | solid-js@2.0.0-beta.20, @solidjs/web@2.0.0-beta.20 |
| vue-vapor | vue@3.6.0-rc.1, @vue/runtime-dom@3.6.0-rc.1, @vue/runtime-vapor@3.6.0-rc.1 |
| preact | preact@10.29.8 |
| svelte | svelte@5.56.7 |
| inferno | inferno@9.1.0 |
| memoized-dom | @memoized-dom/runtime@0.0.9 |

## DOM state-placement matrix

Seven samples per cell; median milliseconds. Synchronous scheduler. Untimed correctness gates plus validation after each timed sample. Checks cover text, classes, counts, order, retained DOM identity and mixed select/reverse/remove-selected/append/reselect sequences. Four placements crossed with component/inline rows, plus vanilla, across all 21 scenarios.

### Both states module

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.80 | 1.70 | 1.10 |
| create 10k | 16.60 | 16.10 | 48.30 |
| replace 1k | 2.20 | 2.40 | 1.40 |
| update 1k | 0.20 | 0.20 | 0.00 |
| select 1k | 0.10 | 0.10 | 0.00 |
| transition 1k | 0.00 | 0.10 | 0.00 |
| swap 1k | 0.30 | 0.30 | 0.00 |
| remove 1k | 0.20 | 0.10 | 0.00 |
| clear 1k | 0.60 | 0.70 | 0.00 |
| replace 10k | 21.40 | 19.60 | 13.90 |
| update 10k | 1.70 | 2.00 | 0.50 |
| select 10k | 0.20 | 0.10 | 0.10 |
| transition 10k | 0.10 | 0.10 | 0.00 |
| swap 10k | 2.60 | 2.60 | 0.00 |
| remove 10k | 2.40 | 1.50 | 0.00 |
| clear 10k | 3.50 | 3.40 | 0.80 |
| append1k 10k | 5.40 | 3.00 | 1.50 |
| prepend1k 10k | 4.80 | 3.90 | 1.20 |
| pop1k 10k | 2.50 | 2.10 | 0.40 |
| reverse 10k | 7.90 | 9.60 | 5.50 |
| remove100 10k | 2.30 | 1.70 | 0.20 |

### Both states component-owned

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.50 | 1.70 | 1.10 |
| create 10k | 15.40 | 25.70 | 48.30 |
| replace 1k | 2.80 | 3.10 | 1.40 |
| update 1k | 0.20 | 0.20 | 0.00 |
| select 1k | 0.10 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.30 | 0.00 |
| remove 1k | 0.20 | 0.20 | 0.00 |
| clear 1k | 0.50 | 0.40 | 0.00 |
| replace 10k | 32.40 | 25.30 | 13.90 |
| update 10k | 2.40 | 1.80 | 0.50 |
| select 10k | 0.10 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.00 | 0.00 |
| swap 10k | 2.70 | 2.20 | 0.00 |
| remove 10k | 2.00 | 1.70 | 0.00 |
| clear 10k | 3.90 | 3.20 | 0.80 |
| append1k 10k | 3.50 | 3.20 | 1.50 |
| prepend1k 10k | 4.60 | 4.30 | 1.20 |
| pop1k 10k | 2.50 | 2.20 | 0.40 |
| reverse 10k | 16.80 | 8.30 | 5.50 |
| remove100 10k | 2.20 | 2.30 | 0.20 |

### Module data, component selection

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.90 | 1.80 | 1.10 |
| create 10k | 20.30 | 19.10 | 48.30 |
| replace 1k | 2.60 | 2.20 | 1.40 |
| update 1k | 0.20 | 0.20 | 0.00 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.20 | 0.00 |
| remove 1k | 0.20 | 0.10 | 0.00 |
| clear 1k | 0.60 | 0.60 | 0.00 |
| replace 10k | 20.80 | 20.90 | 13.90 |
| update 10k | 2.10 | 1.40 | 0.50 |
| select 10k | 0.20 | 0.20 | 0.10 |
| transition 10k | 0.10 | 0.00 | 0.00 |
| swap 10k | 3.40 | 2.30 | 0.00 |
| remove 10k | 2.10 | 2.70 | 0.00 |
| clear 10k | 3.80 | 3.40 | 0.80 |
| append1k 10k | 3.80 | 3.20 | 1.50 |
| prepend1k 10k | 4.70 | 5.10 | 1.20 |
| pop1k 10k | 3.10 | 2.20 | 0.40 |
| reverse 10k | 8.20 | 7.80 | 5.50 |
| remove100 10k | 2.90 | 1.70 | 0.20 |

### Component data, module selection

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.70 | 1.80 | 1.10 |
| create 10k | 20.40 | 16.20 | 48.30 |
| replace 1k | 2.40 | 2.10 | 1.40 |
| update 1k | 0.20 | 0.20 | 0.00 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.30 | 0.00 |
| remove 1k | 0.10 | 0.10 | 0.00 |
| clear 1k | 0.50 | 0.70 | 0.00 |
| replace 10k | 25.30 | 23.50 | 13.90 |
| update 10k | 1.90 | 1.40 | 0.50 |
| select 10k | 0.20 | 0.10 | 0.10 |
| transition 10k | 0.00 | 0.10 | 0.00 |
| swap 10k | 2.70 | 2.90 | 0.00 |
| remove 10k | 2.10 | 1.70 | 0.00 |
| clear 10k | 3.40 | 3.20 | 0.80 |
| append1k 10k | 3.50 | 3.50 | 1.50 |
| prepend1k 10k | 4.10 | 3.70 | 1.20 |
| pop1k 10k | 2.90 | 2.30 | 0.40 |
| reverse 10k | 8.60 | 7.70 | 5.50 |
| remove100 10k | 3.20 | 2.60 | 0.20 |

## DOM timing-stability repeat

The first DOM run had an unusually high vanilla 10k creation median (48.3 ms). A second full DOM suite was run after Octane to check stability. Both matrices are retained; these are independent seven-sample medians, not pooled values. The report does not select the fastest run.

### Both states module — repeated full run

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.90 | 1.90 | 1.30 |
| create 10k | 20.30 | 15.90 | 16.80 |
| replace 1k | 2.10 | 2.40 | 1.10 |
| update 1k | 0.20 | 0.10 | 0.10 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.30 | 0.00 |
| remove 1k | 0.10 | 0.10 | 0.00 |
| clear 1k | 0.60 | 0.50 | 0.10 |
| replace 10k | 20.20 | 23.00 | 13.20 |
| update 10k | 1.90 | 1.40 | 0.30 |
| select 10k | 0.20 | 0.20 | 0.20 |
| transition 10k | 0.10 | 0.10 | 0.00 |
| swap 10k | 2.90 | 2.10 | 0.00 |
| remove 10k | 1.50 | 1.40 | 0.00 |
| clear 10k | 2.80 | 3.60 | 0.80 |
| append1k 10k | 3.30 | 2.80 | 1.00 |
| prepend1k 10k | 6.30 | 8.20 | 1.20 |
| pop1k 10k | 2.60 | 2.10 | 0.30 |
| reverse 10k | 11.50 | 7.70 | 9.10 |
| remove100 10k | 2.40 | 1.70 | 0.10 |

### Both states component-owned — repeated full run

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 1.80 | 2.00 | 1.30 |
| create 10k | 19.70 | 24.70 | 16.80 |
| replace 1k | 2.60 | 2.50 | 1.10 |
| update 1k | 0.20 | 0.20 | 0.10 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.20 | 0.20 | 0.00 |
| remove 1k | 0.20 | 0.20 | 0.00 |
| clear 1k | 0.50 | 0.80 | 0.10 |
| replace 10k | 18.70 | 20.10 | 13.20 |
| update 10k | 1.90 | 1.30 | 0.30 |
| select 10k | 0.20 | 0.10 | 0.20 |
| transition 10k | 0.10 | 0.10 | 0.00 |
| swap 10k | 2.80 | 2.10 | 0.00 |
| remove 10k | 1.90 | 1.20 | 0.00 |
| clear 10k | 3.00 | 2.90 | 0.80 |
| append1k 10k | 3.20 | 3.00 | 1.00 |
| prepend1k 10k | 4.30 | 4.10 | 1.20 |
| pop1k 10k | 2.50 | 2.10 | 0.30 |
| reverse 10k | 8.50 | 12.00 | 9.10 |
| remove100 10k | 2.20 | 1.70 | 0.10 |

### Module data, component selection — repeated full run

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 2.30 | 2.10 | 1.30 |
| create 10k | 20.80 | 19.70 | 16.80 |
| replace 1k | 2.40 | 2.30 | 1.10 |
| update 1k | 0.20 | 0.20 | 0.10 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.30 | 0.20 | 0.00 |
| remove 1k | 0.10 | 0.10 | 0.00 |
| clear 1k | 0.60 | 0.80 | 0.10 |
| replace 10k | 20.00 | 22.20 | 13.20 |
| update 10k | 2.00 | 1.60 | 0.30 |
| select 10k | 0.10 | 0.20 | 0.20 |
| transition 10k | 0.00 | 0.10 | 0.00 |
| swap 10k | 3.00 | 2.20 | 0.00 |
| remove 10k | 2.10 | 1.60 | 0.00 |
| clear 10k | 3.10 | 3.40 | 0.80 |
| append1k 10k | 4.10 | 2.90 | 1.00 |
| prepend1k 10k | 4.80 | 6.50 | 1.20 |
| pop1k 10k | 3.70 | 2.30 | 0.30 |
| reverse 10k | 11.20 | 12.10 | 9.10 |
| remove100 10k | 2.20 | 1.60 | 0.10 |

### Component data, module selection — repeated full run

| Operation | Component rows | Inline rows | Vanilla |
| --- | --- | --- | --- |
| create 1k | 2.40 | 1.70 | 1.30 |
| create 10k | 16.30 | 18.60 | 16.80 |
| replace 1k | 2.20 | 2.20 | 1.10 |
| update 1k | 0.20 | 0.20 | 0.10 |
| select 1k | 0.00 | 0.00 | 0.00 |
| transition 1k | 0.00 | 0.00 | 0.00 |
| swap 1k | 0.40 | 0.30 | 0.00 |
| remove 1k | 0.10 | 0.10 | 0.00 |
| clear 1k | 0.60 | 0.50 | 0.10 |
| replace 10k | 25.80 | 20.40 | 13.20 |
| update 10k | 1.70 | 1.60 | 0.30 |
| select 10k | 0.20 | 0.20 | 0.20 |
| transition 10k | 0.00 | 0.10 | 0.00 |
| swap 10k | 3.20 | 2.00 | 0.00 |
| remove 10k | 1.80 | 1.50 | 0.00 |
| clear 10k | 3.00 | 3.10 | 0.80 |
| append1k 10k | 3.40 | 3.40 | 1.00 |
| prepend1k 10k | 5.30 | 4.30 | 1.20 |
| pop1k 10k | 2.80 | 2.50 | 0.30 |
| reverse 10k | 11.70 | 12.40 | 9.10 |
| remove100 10k | 2.00 | 1.70 | 0.10 |

## Octane canonical and reorder comparison

Default ten targets; eight samples per cell. Canonical uses three initial warmups; reorder uses two per-operation warmups. Tables show median milliseconds per operation. The upstream JSON retains median, minimum, sample count and available dispersion statistics, not every individual timing sample.

Canonical verifies required DOM changes immediately after timing and checks selection transitions. Reorder checks permutations and retained DOM identity before timings. Octane-specific insertion, production-call and scratch-allocation gates apply only to Octane targets; those work counts are not timing values.

Reorder begins with 1,000 rows per sample and divides batch duration by repetitions: reverse/shuffle 4, rotations 100, insertion 1, first/scattered removal 20, displacements 20. Repeated removal changes list size within its batch.

### js-framework

Samples: 8. Status: PASS.

| Operation | octane-tsrx | octane-jsx | react | ripple | solid |
| --- | --- | --- | --- | --- | --- |
| run | 7.500 | 10.200 | 15.200 | 6.800 | 9.000 |
| replace | 13.200 | 13.400 | 24.500 | 11.200 | 14.000 |
| add | 7.200 | 10.400 | 14.100 | 5.900 | 7.200 |
| update | 0.700 | 1.200 | 1.700 | 0.500 | 2.600 |
| select | 0.400 | 0.800 | 0.900 | 0.200 | 0.700 |
| swap | 0.800 | 1.800 | 11.600 | 0.400 | 0.700 |
| remove | 0.600 | 1.100 | 1.200 | 0.400 | 0.500 |
| runlots | 70.900 | 76.500 | 446.100 | 62.500 | 59.900 |
| select_lots | 0.400 | 7.400 | 3.600 | 0.200 | 3.400 |
| clear | 60.000 | 67.200 | 119.500 | 63.400 | 64.800 |

| Operation | vue-vapor | preact | svelte | inferno | memoized-dom |
| --- | --- | --- | --- | --- | --- |
| run | 8.400 | 20.100 | 10.500 | 10.200 | 7.100 |
| replace | 13.000 | 30.400 | 13.900 | 13.000 | 11.200 |
| add | 7.400 | 18.200 | 9.300 | 7.100 | 7.900 |
| update | 0.600 | 2.500 | 1.100 | 0.800 | 0.600 |
| select | 0.400 | 1.000 | 1.500 | 0.500 | 0.200 |
| swap | 0.600 | 0.900 | 0.800 | 1.100 | 0.800 |
| remove | 0.400 | 0.900 | 0.700 | 0.800 | 1.200 |
| runlots | 65.400 | 217.000 | 79.100 | 81.100 | 64.500 |
| select_lots | 0.300 | 5.000 | 8.700 | 3.400 | 0.100 |
| clear | 61.400 | 97.200 | 66.100 | 98.000 | 65.000 |

#### Memoized DOM timing dispersion

| Operation | Median ms | Minimum ms | p95 ms | RME % | Samples |
| --- | --- | --- | --- | --- | --- |
| run | 7.100 | 5.800 | 14.300 | 34.77 | 8 |
| replace | 11.200 | 9.600 | 14.300 | 9.68 | 8 |
| add | 7.900 | 5.700 | 11.700 | 23.27 | 8 |
| update | 0.600 | 0.500 | 1.000 | 21.74 | 8 |
| select | 0.200 | 0.000 | 0.400 | 85.62 | 8 |
| swap | 0.800 | 0.600 | 1.400 | 25.88 | 8 |
| remove | 1.200 | 0.700 | 4.500 | 64.22 | 8 |
| runlots | 64.500 | 59.900 | 80.500 | 8.62 | 8 |
| select_lots | 0.100 | 0.000 | 0.100 | 69.24 | 8 |
| clear | 65.000 | 52.000 | 78.700 | 10.20 | 8 |

### keyed-reorder-matrix

Samples: 8. Status: PASS.

| Operation | octane-tsrx | octane-jsx | react | ripple | solid |
| --- | --- | --- | --- | --- | --- |
| reverse | 2.775 | 3.475 | 5.350 | 2.775 | 3.300 |
| shuffle | 5.775 | 4.900 | 5.800 | 3.350 | 3.050 |
| rotatef | 0.195 | 0.732 | 4.955 | 0.107 | 0.237 |
| rotateb | 0.149 | 0.620 | 0.274 | 0.051 | 0.205 |
| prepend100 | 1.700 | 1.500 | 2.200 | 1.300 | 1.200 |
| append100 | 1.800 | 1.400 | 1.700 | 0.800 | 1.200 |
| insertmid100 | 2.100 | 1.500 | 2.400 | 1.000 | 1.300 |
| removefirst | 0.105 | 0.460 | 0.325 | 0.190 | 0.215 |
| removeevery10 | 0.420 | 0.620 | 0.735 | 0.950 | 0.605 |
| displace3 | 0.185 | 0.625 | 0.355 | 0.140 | 0.425 |
| displace4 | 0.215 | 0.640 | 0.335 | 0.215 | 0.420 |
| displace5 | 0.205 | 0.670 | 0.385 | 0.430 | 0.365 |
| displace6 | 0.210 | 0.670 | 0.340 | 0.150 | 0.395 |
| displace8 | 0.375 | 0.690 | 0.405 | 0.165 | 0.365 |

| Operation | vue-vapor | preact | svelte | inferno | memoized-dom |
| --- | --- | --- | --- | --- | --- |
| reverse | 3.375 | 6.525 | 28.075 | 3.125 | 3.675 |
| shuffle | 4.075 | 5.450 | 3.975 | 3.575 | 4.175 |
| rotatef | 1.780 | 0.344 | 0.245 | 0.389 | 0.219 |
| rotateb | 0.499 | 0.334 | 0.145 | 0.288 | 0.232 |
| prepend100 | 0.900 | 3.500 | 1.500 | 1.100 | 1.200 |
| append100 | 0.800 | 3.300 | 1.700 | 1.600 | 1.200 |
| insertmid100 | 0.900 | 4.000 | 1.400 | 1.300 | 1.200 |
| removefirst | 0.085 | 0.405 | 0.180 | 0.120 | 0.315 |
| removeevery10 | 0.740 | 0.680 | 0.445 | 0.560 | 0.475 |
| displace3 | 0.645 | 4.240 | 0.215 | 0.360 | 0.200 |
| displace4 | 0.635 | 4.450 | 0.225 | 0.385 | 0.360 |
| displace5 | 0.680 | 4.205 | 0.210 | 0.360 | 0.270 |
| displace6 | 0.630 | 4.260 | 0.245 | 0.385 | 0.290 |
| displace8 | 0.710 | 4.430 | 0.245 | 0.520 | 0.275 |

| Adapter | Retained row identity |
| --- | --- |
| octane-tsrx | pass |
| octane-jsx | pass |
| react | pass |
| ripple | pass |
| solid | pass |
| vue-vapor | pass |
| preact | pass |
| svelte | pass |
| inferno | pass |
| memoized-dom | pass |

#### Memoized DOM timing dispersion

| Operation | Median ms | Minimum ms | p95 ms | RME % | Samples |
| --- | --- | --- | --- | --- | --- |
| reverse | 3.675 | 2.675 | 4.075 | 13.71 | 8 |
| shuffle | 4.175 | 3.175 | 7.300 | 26.82 | 8 |
| rotatef | 0.219 | 0.192 | 0.377 | 22.20 | 8 |
| rotateb | 0.232 | 0.190 | 0.243 | 8.44 | 8 |
| prepend100 | 1.200 | 0.900 | 2.200 | 26.99 | 8 |
| append100 | 1.200 | 0.800 | 1.300 | 15.93 | 8 |
| insertmid100 | 1.200 | 0.800 | 2.000 | 27.44 | 8 |
| removefirst | 0.315 | 0.285 | 0.480 | 16.29 | 8 |
| removeevery10 | 0.475 | 0.380 | 0.605 | 14.91 | 8 |
| displace3 | 0.200 | 0.185 | 0.265 | 12.23 | 8 |
| displace4 | 0.360 | 0.200 | 0.705 | 38.82 | 8 |
| displace5 | 0.270 | 0.195 | 0.920 | 57.79 | 8 |
| displace6 | 0.290 | 0.210 | 0.555 | 26.99 | 8 |
| displace8 | 0.275 | 0.220 | 0.300 | 8.55 | 8 |

## Provenance and reproduction

The upstream checkout is pinned and clean. Memoized-dom dirty status refers to generated benchmark outputs; tracked diffs are listed in source-status.json.

```sh
git checkout 581b40f958eb20201ef7efc968fcf9ac26a2d46d
bun run build
export PUPPETEER_EXECUTABLE_PATH=/path/to/chromium-153
export PLAYWRIGHT_BROWSERS_PATH=/path/to/isolated-playwright-cache
export CPU_THROTTLE=1
bun run bench
bun run bench:octane
```

See browser-proof.json for the binary path/hash and both live browser versions. Setup and build output are preserved in setup.log and build.log. Original upstream results are preserved as octane-canonical.json, octane-reorder.json and octane-results.json.
