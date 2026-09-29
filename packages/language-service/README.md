# @memoized-dom/language-service

TypeScript editor diagnostics and code fixes for memoized-dom. Compiler errors
come from `@memoized-dom/compiler`'s structured graph diagnostic API, so the
editor, Vite overlay, and direct compiler report the same restrictions.
Compiler diagnostics preserve the authored ESTree start/end range, so route
attributes, invalid writes, and other failures are underlined at their actual
source node instead of a generic one-character position.

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

This plugin uses the TypeScript 6 tsserver API. Its workspace build uses a
package-local TypeScript 6 dependency; the repository's TypeScript 7 compiler
remains available for the other packages. To use the plugin in an editor,
select a TypeScript 6 tsserver; the TypeScript 7 language server does not load
tsserver plugins.

TypeScript language-service plugins run in editors powered by tsserver. They
do not add diagnostics to standalone `tsc`; the analysis core is kept separate
so a future CLI can report the same diagnostics in CI.

The first diagnostic suggests `const` for initialized `let` bindings that are
never reassigned. Its message explains that memoized-dom reactivity follows
reads and writes rather than declaration keywords; `const` arrays and objects
can still mutate their contents. The editor fix changes only the declaration
keyword.

Set `"preferConst": false` on the plugin entry to disable this diagnostic.
Set `"compilerDiagnostics": false` only when compiler errors should be hidden
from tsserver.
