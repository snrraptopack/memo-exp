# Architectural & Compiler Diagnostic Report

This document details five distinct compiler, plugin, and workspace issues identified during the construction and testing of the `@memoized-dom/data` reactivity test laboratory.

---

## 1. Optional Chaining (`?.map(...)`) Rejection on Keyed List Sites

### Description
When attempting to render a list from an optional array using optional chaining (`items?.map(...)`), the Memoized DOM compiler rejects the `key={...}` attribute on row elements, raising a compiler error claiming that `key` is only meaningful on list rows.

### Reproducible Example
```tsx
import { $fetch } from '@memoized-dom/data';

interface User {
  id: string;
  name: string;
}

export function UserList() {
  // $fetch returns a resource where `data` is `User[] | undefined`
  const usersResource = $fetch<User[]>('/api/users');

  return (
    <ul class="user-list">
      {/* ❌ Throws Compiler Error: key={...} is only meaningful on list rows */}
      {usersResource.data?.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

### Diagnostic Output
```text
memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)
```

### Root Cause Analysis
* In `packages/compiler/src/lists/map-site.ts`, `matchMapCall(expr)` explicitly matches `t.isCallExpression(expr)` and `t.isMemberExpression(callee)`.
* When JavaScript code uses optional chaining (`?.map`), Babel parses the expression as an `OptionalCallExpression` containing an `OptionalMemberExpression`.
* Because `matchMapCall` ignores `OptionalCallExpression`, the compiler fails to register the JSX block as a reactive list site (`MapSite`).
* Later during component analysis in `packages/compiler/src/analysis.ts`, `analyzeComponent` encounters `key={user.id}` on an element that was not registered as a list row, triggering a diagnostic error.

---

## 2. Type Assertion (`as Type`) Suppressing Export Category Recognition

### Description
Exporting a function or helper wrapped in a TypeScript `as` type assertion (such as `export const myFunc = ((...) => ...) as MyType;`) causes the compiler's module linker to fail to recognize the symbol as an export, throwing a linker error when another module imports it.

### Reproducible Example

**`mock-api.ts`**
```ts
// ❌ Type assertion wrapper node `as typeof fetch`
export const mockFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  return new Response(JSON.stringify({ status: 'ok' }));
}) as typeof fetch;
```

**`App.tsx`**
```tsx
import { createDataRuntime } from '@memoized-dom/data';
import { mockFetch } from './mock-api';

// ❌ Throws Compiler Linker Error
const runtime = createDataRuntime({ fetch: mockFetch });
```

### Diagnostic Output
```text
memo-dom: 'mockFetch' is not a linkable state, function, or component export of './mock-api'
```

### Root Cause Analysis
* In `packages/compiler/src/linker.ts`, `linkImports` scans top-level module export AST nodes to categorize exports into `component`, `state`, or `function` tables.
* When a function is exported with a type assertion (`(...) as typeof fetch`), Babel wraps the initializer AST node in a `TSAsExpression`.
* The export scanner checks raw node types without unwrapping `TSAsExpression` or `TSTypeAssertion` nodes. Consequently, the export scanner fails to match the expression to its internal function helper table (`ctx.helpers`), omitting the exported symbol from `manifest.exports`.
* When `App.tsx` imports `mockFetch`, `linker.ts` verifies that `mockFetch` exists in `./mock-api`'s export table and throws a diagnostic error when it is not found.

---

## 3. Resource Method Calls Triggering Rule 13 (`R13`) and Rule 14 (`R14`) Mutation Bans

### Description
Calling instance methods on a `$fetch` resource (such as `resource.refresh()`, `resource.abort()`, `resource.append()`, `resource.replace()`, or `resource.remove()`) inside event handlers triggers compiler diagnostic errors:
* If declared **inside a component body**, it throws **Rule 14 (`R14`)**: `cannot mutate per-instance derivation 'usersResource' (R14)`.
* If declared **at module scope**, it throws **Rule 13 (`R13`)**: `cannot mutate computed 'usersResource' (R13)`.

### Reproducible Example 1: Component Scope (Triggers R14)
```tsx
import { $fetch } from '@memoized-dom/data';

export function ComponentScopedList() {
  // `usersResource` declared inside component function
  const usersResource = $fetch('/api/users');

  function handleRefresh() {
    // ❌ Throws Compiler Error (R14)
    usersResource.refresh();
  }

  return <button onClick={handleRefresh}>Reload</button>;
}
```

### Diagnostic Output (R14)
```text
memo-dom: cannot mutate per-instance derivation 'usersResource' (R14) — write its source instead
```

### Reproducible Example 2: Module Scope (Triggers R13)
```tsx
import { $fetch } from '@memoized-dom/data';

// `usersResource` declared at top-level module scope
const usersResource = $fetch('/api/users');

export function ModuleScopedList() {
  function handleRefresh() {
    // ❌ Throws Compiler Error (R13)
    usersResource.refresh();
  }

  return <button onClick={handleRefresh}>Reload</button>;
}
```

### Diagnostic Output (R13)
```text
memo-dom: cannot mutate computed 'usersResource' (R13) — write its SOURCE state instead
```

### Root Cause Analysis
* In `packages/compiler/src/handlers/analyze.ts`, Rules R13 and R14 prevent illegal direct mutations of computed or derived local state bindings (e.g. `const double = count * 2; double++`).
* **Component-scoped resources:** Initializing a resource via a function call inside a component function (e.g. `const r = $fetch(...)`) marks the variable as an instance derived binding (`instDerived`). Any method call on `r` (e.g. `r.refresh()`) is checked by `analyze.ts` and rejected under Rule 14 (`R14`).
* **Module-scoped resources:** Initializing a resource via a function call at module scope marks the exported/constant variable as computed state (`stateKind: 'computed'`). Any method call on `r` (e.g. `r.refresh()`) is checked by `analyze.ts` and rejected under Rule 13 (`R13`).
* Because `$fetch` resources rely on instance method calls (`.refresh()`, `.abort()`, `.append()`, `.replace()`, `.remove()`) for optimistic collection changes and manual revalidations, treating method invocations on resource objects as illegal computed state mutations blocks standard resource workflows.

---

## 4. Raw Unescaped ANSI Color Characters in Vite Plugin Errors

### Description
When a Memoized DOM compiler error occurs during Vite development server execution, the error message output in the console contains raw, unrendered ANSI escape sequences (`\x1B[90m`, `\x1B[31m`, `\x1B[39m`) rather than formatted text.

### Reproducible Example
Triggering any compiler syntax or structural rule error during `vite dev` server execution outputs the following formatted payload in the terminal:

### Diagnostic Output
```text
error when starting dev server:
{
  message: 'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)\n' +
    '\x1B[0m \x1B[90m 291 |\x1B[39m           \x1B[33m<\x1B[39m\x1B[33mdiv\x1B[39m \x1B[33mclass\x1B[39m\x1B[33m=\x1B[39m\x1B[32m"tasks-grid"\x1B[39m\x1B[33m>\x1B[39m\n' +
    ' \x1B[90m 292 |\x1B[39m             \x1B[33m{\x1B[39mtasksResource\x1B[33m.\x1B[39mdata\x1B[33m?.\x1B[39mmap((task\x1B[33m:\x1B[39m \x1B[33mTask\x1B[39m) \x1B[33m=>\x1B[39m (\n' +
    '\x1B[31m\x1B[1m>\x1B[22m\x1B[39m\x1B[90m 293 |\x1B[39m               \x1B[33m<\x1B[39m\x1B[33mTaskCard\x1B[39m\n',
  id: 'C:/Users/babyface/Desktop/memoized-dom/examples/data-reactivity/DataReactivityApp.tsx',
  plugin: 'memoized-dom'
}
```

### Root Cause Analysis
* Babel's `buildCodeFrameError` utility automatically formats code frames with ANSI color codes for terminal display (`\x1B[...]`).
* In `packages/vite/src/plugin.ts`, when an error is caught during Vite graph transformation, the error object is forwarded to Vite's plugin context (`context.error(error)`).
* When Vite logs the error object to non-TTY streams or serializes error messages for dev server logging, the raw string property contains unescaped `\x1B` control characters, printing escape characters as literal text in the console output.

---

## 5. Missing Package Export in Root Workspace `devDependencies`

### Description
Importing `@memoized-dom/data` in authored application modules or examples fails with module resolution errors until `@memoized-dom/data` is explicitly declared in the root workspace `devDependencies`.

### Reproducible Example
```ts
import { $fetch, $action } from '@memoized-dom/data';
```

### Diagnostic Output
```text
Cannot find module '@memoized-dom/data' or its corresponding type declarations.
```

### Root Cause Analysis
* The root `package.json` specifies `"workspaces": ["packages/*"]`.
* Under `devDependencies`, `package.json` declared `"@memoized-dom/compiler"`, `"@memoized-dom/router"`, `"@memoized-dom/runtime"`, and `"@memoized-dom/vite"`, but omitted `"@memoized-dom/data"`.
* As a result, running package linkers (`bun install`) created workspace symlinks for the other packages in `node_modules/@memoized-dom/` while leaving `@memoized-dom/data` unlinked for non-relative module specifiers.
