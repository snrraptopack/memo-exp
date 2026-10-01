# Corrected virtual DOM baseline — 9811e0c

Commit: `9811e0c27ba84f30b70f1ec7b2fa1ef67851ff67`. Command: `bun run bench`. Build and DOM benchmark passed. One complete run, seven samples per cell.

Chromium Chromium 153.0.8010.0; Bun 1.4.2. Virtual environment: eight CPU equivalents, 8 GiB container memory limit. Synchronous scheduler; JavaScript and DOM writes timed, completed paint excluded. Setup and validation outside timing. Retained node identity and mixed-operation checks passed. Zero values indicate timer resolution.

This commit restores conservative content-update fallbacks for opaque-produced collections. Treat these timings as the corrected ownership baseline; earlier targeted owner-local update results do not measure this restored fallback.

C / I = component rows / inline rows. Milliseconds.

| Operation | Both module C / I | Both component C / I | Module data, component selection C / I | Component data, module selection C / I | Vanilla |
|---|---:|---:|---:|---:|---:|
| create 1k | 1.70 / 1.40 | 1.60 / 1.30 | 1.60 / 1.60 | 1.50 / 1.70 | 0.90 |
| create 10k | 14.90 / 14.10 | 14.50 / 12.40 | 15.90 / 13.30 | 16.50 / 13.70 | 8.50 |
| replace 1k | 2.00 / 1.90 | 2.00 / 1.80 | 1.90 / 1.90 | 2.00 / 2.00 | 1.00 |
| update 1k | 0.30 / 0.20 | 0.30 / 0.30 | 0.20 / 0.20 | 0.40 / 0.20 | 0.00 |
| select 1k | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| transition 1k | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 |
| swap 1k | 0.30 / 0.30 | 0.40 / 0.30 | 0.30 / 0.40 | 0.30 / 0.30 | 0.00 |
| remove 1k | 0.20 / 0.20 | 0.20 / 0.20 | 0.30 / 0.20 | 0.30 / 0.30 | 0.00 |
| clear 1k | 0.50 / 0.60 | 0.60 / 0.40 | 0.50 / 0.40 | 0.50 / 0.60 | 0.10 |
| replace 10k | 19.00 / 19.20 | 18.00 / 15.80 | 17.70 / 19.20 | 17.80 / 17.30 | 9.70 |
| update 10k | 3.10 / 2.50 | 3.10 / 2.10 | 3.40 / 2.40 | 3.10 / 2.70 | 0.30 |
| select 10k | 0.20 / 0.10 | 0.10 / 0.10 | 0.20 / 0.10 | 0.10 / 0.10 | 0.10 |
| transition 10k | 0.00 / 0.10 | 0.10 / 0.00 | 0.10 / 0.00 | 0.00 / 0.00 | 0.00 |
| swap 10k | 3.50 / 3.30 | 3.50 / 3.10 | 3.90 / 3.30 | 3.60 / 3.40 | 0.00 |
| remove 10k | 2.40 / 2.30 | 2.90 / 2.10 | 3.30 / 2.10 | 2.90 / 2.60 | 0.00 |
| clear 10k | 2.60 / 2.50 | 2.80 / 2.40 | 2.40 / 2.50 | 2.80 / 2.40 | 0.60 |
| append1k 10k | 3.50 / 3.60 | 4.00 / 3.20 | 3.80 / 3.30 | 4.00 / 3.50 | 1.00 |
| prepend1k 10k | 4.80 / 4.50 | 5.30 / 4.30 | 4.90 / 4.30 | 4.70 / 5.00 | 0.90 |
| pop1k 10k | 2.40 / 2.50 | 3.10 / 2.40 | 3.10 / 2.30 | 3.00 / 2.40 | 0.20 |
| reverse 10k | 7.90 / 7.90 | 9.60 / 7.70 | 8.60 / 9.60 | 8.10 / 8.10 | 4.50 |
| remove100 10k | 2.40 / 2.60 | 2.90 / 2.30 | 3.40 / 2.10 | 3.00 / 2.60 | 0.10 |
