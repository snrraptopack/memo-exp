# @memoized-dom/language-service

TypeScript editor diagnostics and code fixes for memoized-dom.

Add the plugin to the application `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@memoized-dom/language-service"
      }
    ]
  }
}
```

TypeScript language-service plugins run in editors powered by tsserver. They
do not add diagnostics to standalone `tsc`; the analysis core is kept separate
so a future CLI can report the same diagnostics in CI.

The first diagnostic suggests `const` for initialized `let` bindings that are
never reassigned. Its message explains that memoized-dom reactivity follows
reads and writes rather than declaration keywords; `const` arrays and objects
can still mutate their contents. The editor fix changes only the declaration
keyword.

Set `"preferConst": false` on the plugin entry to disable this diagnostic.
