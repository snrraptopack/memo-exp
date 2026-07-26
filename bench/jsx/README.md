# Authored JSX Benchmark

> Date: 2026-07-26. Production compiler/runtime output under happy-dom.

Run:

```bash
bun run bench:jsx
```

## Question

What does the ordered general DOM patch path cost compared with specialized
scalar attribute emission?

Both cases are normal authored TSX and update the same text, class array,
style object, `tabIndex`, ID, and ARIA attribute. The spread case adds one
stable base-prop spread before the same dynamic attributes and event:

```tsx
<button {...base} class={classes} style={style} onClick={increment}>
  {count}
</button>
```

The spread requires source-order override semantics, so the compiler emits one
`patchDomProps()` call. The explicit form retains specialized inline scalar
guards. Output is verified on every mount sample and after every measured
update sample.

Mount samples perform 500 complete mount, insertion, unregister, and removal
operations. Update samples perform 5,000 clicks against one mounted instance.
Each process reports the median of nine samples.

## Results

The table records the median explicit and spread time from three independent
process medians on the same machine.

| Scenario | Explicit attributes | Ordered spread path | Relative |
|---|---:|---:|---:|
| Mount + unmount | 398,693.2 ns | 443,555.6 ns | 1.11x |
| Rich attribute update | 95,103.8 ns | 114,005.5 ns | 1.20x |

Mount ratios ranged from 1.11x to 1.32x. Update ratios ranged from 1.19x to
1.31x. These measurements support retaining the specialized no-spread path;
they do not justify weakening spread override semantics.

## Interpretation

This suite is intended to protect the specialized no-spread path while making
the cost of full JavaScript spread semantics visible. A spread slowdown is not
evidence that spreads should be approximated or rejected; it identifies the
runtime patcher as a separate optimization surface.

## Limits

Happy-dom is not a browser rendering engine. This suite excludes layout,
paint, SVG, keyed reconciliation, component children, compilation throughput,
memory retention, and unknown dynamic event handlers. It must not be reported
as an end-to-end framework comparison.
