# Corpus coverage and linker ablation

Accepted corpus: 15 programs, 48 modules, 274 nonblank/noncomment LOC.

| Program | LOC | Modules | Exact | Bounded | Param-relative | Unbounded | Ablated unbounded | Reader keys |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| alias-imports | 15 | 3 | 4 | 0 | 0 | 0 | 2 | 3 |
| branch-reads | 10 | 2 | 6 | 0 | 0 | 0 | 3 | 3 |
| dashboard-derived | 18 | 4 | 4 | 0 | 0 | 0 | 2 | 5 |
| dynamic-key | 8 | 2 | 0 | 2 | 0 | 0 | 1 | 3 |
| finance-summary | 25 | 5 | 9 | 0 | 0 | 0 | 5 | 7 |
| form-validation | 19 | 3 | 0 | 0 | 7 | 0 | 2 | 7 |
| helper-depth-1 | 11 | 2 | 0 | 1 | 2 | 0 | 1 | 2 |
| helper-depth-2 | 14 | 2 | 0 | 1 | 3 | 0 | 1 | 2 |
| helper-depth-4 | 14 | 2 | 0 | 1 | 5 | 0 | 1 | 2 |
| inventory-dashboard | 26 | 5 | 2 | 2 | 4 | 0 | 5 | 11 |
| notification-center | 24 | 4 | 1 | 6 | 0 | 0 | 3 | 7 |
| permissions-form | 26 | 4 | 2 | 2 | 4 | 0 | 4 | 6 |
| reexport-chain | 10 | 3 | 2 | 0 | 0 | 0 | 1 | 2 |
| rejected-namespace | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| shopping-cart | 15 | 2 | 2 | 4 | 0 | 0 | 3 | 4 |
| todo-board | 39 | 5 | 3 | 5 | 4 | 0 | 6 | 9 |

Across accepted programs, unbounded write-effect sites are **0%** with linked summaries and **45.45%** with imported function summaries ablated.

The ablation preserves canonical imported state/component identity and disables only cross-module function-summary propagation.

Counts include authored mutation expressions and calls whose compiler summary has a write effect. The corpus is representative and purpose-built; it is not claimed to be a random sample of production applications.
