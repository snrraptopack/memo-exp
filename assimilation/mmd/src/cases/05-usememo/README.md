# 05-usememo (MMD lowering)

Hand-lowered equivalent of the React `useMemo` chain case.

## Lowering demonstrated

| React | MMD |
|---|---|
| `useMemo(() => count * 2, [count])` | `const doubled = count * 2` |
| `useMemo(() => \`${name}:${doubled}\`, [name, doubled])` | `const label = \`${name}:${doubled}\`` — derivation chains replay in order |

Dep arrays vanish — read tracking is the dependency mechanism.

## Same checklist as the React version

1. `alpha:2` on mount.
2. **count +1** → `alpha:4`, `alpha:6`, …
3. **rename** → `beta:6`.
4. No stale `name:doubled` combinations ever visible.

## Notes / divergences

- This lowering **is** the idiomatic form — `const` derivations are how
  native MMD expresses derived values. No separate idiomatic block needed.

_(fill in when verified)_
