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

The plugin also recognizes `@middleware` and `@Input` references on server
functions. Imports and local bindings used by those annotations count as used,
and TypeScript checks middleware signatures and schema outputs against the
function's named parameters. Errors underline the corresponding JSDoc tag.
The checks run on an in-memory copy; source files and runtime code are unchanged.

Standalone `tsc` does not load language-service plugins and still treats custom
tag references as comments. Annotation type checks are provided by the editor
plugin; there is no additional command to run.

If Vite uses a custom server root, set `"server": "backend"` on the plugin
entry. Set `"serverFunctionAnnotations": false` on the plugin
entry to disable annotation checks.

The first diagnostic suggests `const` for initialized `let` bindings that are
never reassigned. Its message explains that memoized-dom reactivity follows
reads and writes rather than declaration keywords; `const` arrays and objects
can still mutate their contents. The editor fix changes only the declaration
keyword.

Set `"preferConst": false` on the plugin entry to disable this diagnostic.
Set `"compilerDiagnostics": false` only when compiler errors should be hidden
from tsserver.
