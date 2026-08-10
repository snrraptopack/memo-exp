# Concrete-execution precision/recall oracle

| Case | Scenario | |S| | |O| | |C| | Precision | Recall |
|---|---|---:|---:|---:|---:|---:|
| aliased-import | increment through exported mutator | 1 | 1 | 1 | 100.0% | 100.0% |
| aliased-import | decrement through the same alias | 1 | 1 | 1 | 100.0% | 100.0% |
| aliased-import | exact reset through defining export | 1 | 1 | 1 | 100.0% | 100.0% |
| helper-depth-four | four-level parameter-relative chain | 1 | 1 | 1 | 100.0% | 100.0% |
| helper-depth-four | repeat four-level chain | 1 | 1 | 1 | 100.0% | 100.0% |
| helper-depth-four | second parameter-relative leaf | 1 | 1 | 1 | 100.0% | 100.0% |
| conditional-branch | inactive branch write | 1 | 0 | 0 | 0.0% | 100.0% |
| conditional-branch | active primary branch write | 1 | 1 | 1 | 100.0% | 100.0% |
| conditional-branch | switch active branch | 1 | 1 | 1 | 100.0% | 100.0% |
| conditional-branch | now-inactive primary write | 1 | 0 | 0 | 0.0% | 100.0% |
| conditional-branch | new active branch write | 1 | 1 | 1 | 100.0% | 100.0% |
| conditional-branch | switch back to primary | 1 | 1 | 1 | 100.0% | 100.0% |
| cross-module-derived-chain | propagate through two files | 2 | 2 | 2 | 100.0% | 100.0% |
| cross-module-derived-chain | repeat two-file propagation | 2 | 2 | 2 | 100.0% | 100.0% |
| cross-module-derived-chain | reverse two-file propagation | 2 | 2 | 2 | 100.0% | 100.0% |
| independent-object-fields | left path first write | 3 | 2 | 2 | 66.7% | 100.0% |
| independent-object-fields | right path first write | 3 | 2 | 2 | 66.7% | 100.0% |
| independent-object-fields | left path repeated write | 3 | 2 | 2 | 66.7% | 100.0% |
| independent-object-fields | right path repeated write | 3 | 2 | 2 | 66.7% | 100.0% |
| multiple-import-aliases | first alias chain | 3 | 2 | 2 | 66.7% | 100.0% |
| multiple-import-aliases | second alias chain | 3 | 2 | 2 | 66.7% | 100.0% |
| multiple-import-aliases | first alias chain repeated | 3 | 2 | 2 | 66.7% | 100.0% |
| collection-receiver | array push receiver | 2 | 2 | 1 | 100.0% | 100.0% |
| collection-receiver | array shift receiver | 2 | 2 | 2 | 100.0% | 100.0% |
| collection-receiver | array splice receiver | 2 | 2 | 1 | 100.0% | 100.0% |

Aggregate: TP=36, FP=9, FN=0, precision=80.0%, recall=100.0%.

The oracle uses a separate Babel transform plus runtime object-identity logging; it does not reuse memoized-dom read/write extraction. Each scenario compares the compiler selection S with the dependencies observed on that concrete execution O. C is the set of derived outputs whose values changed.
