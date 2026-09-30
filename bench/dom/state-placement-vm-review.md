# User-reported VM review of `661d247`

The user ran the state-placement suite twice in Chromium on a virtual machine.
All 21 scenarios passed across eight compiled variants and vanilla, with DOM
validation after each timed sample. These are user-reported measurements, not
the local machine's `state-placement-latest.json`. Each range contains the two
runs' medians, each from seven samples. Values are milliseconds at 10,000 rows;
C/I means component/inline rows.

| Operation | Both module C/I | Both component C/I | Module data, component selection C/I | Component data, module selection C/I |
|---|---|---|---|---|
| Update every tenth row | 2.1–2.2 / 4.8–4.9 | 1.2–1.3 / 1.0–1.2 | 2.4–2.5 / 5.3–5.4 | 0.8 / 1.0–1.2 |
| Select a row | 1.9–2.0 / 4.2–4.5 | 2.2–2.4 / 0.1–0.2 | 3.6 / 2.4–2.8 | 1.6 / 4.1 |
| Swap two rows | 3.9 / 7.1–8.4 | 7.9–8.2 / 12.2–14.2 | 4.1–4.2 / 6.4–6.9 | 7.6–7.7 / 12.3–12.8 |
| Reverse list | 7.2–7.5 / 8.3–8.8 | 7.5–7.8 / 8.5–8.8 | 7.6–8.3 / 8.4–8.9 | 7.2–7.3 / 7.5–8.0 |
| Clear list | 2.5 / 10.1–16.2 | 2.5 / 4.9 | 2.5 / 4.8–5.1 | 2.3–2.4 / 5.0–5.8 |

The review identifies targeted content updates for component-owned data and
previous/new-key selection updates for component-owned inline rows. Component
row callbacks add `_update()` and `markDirtySubtree` after the owner callback;
their contribution to the gap needs isolation. Component-owned swaps and inline
teardown are distinct open performance issues.

The reviewer also requested retained DOM node identity checks and mixed
selection/structure sequences. Those are now benchmark gates. The VM timings
above predate those stronger gates and must not be described as validating them.
