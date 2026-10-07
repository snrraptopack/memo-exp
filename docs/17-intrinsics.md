# Compiler intrinsics

These names are available in compiled memoized-dom source without imports:

| Name | Purpose | Reference |
|---|---|---|
| `$effect(callback)` | Replay synchronous imperative work when its reactive reads change | [Effects and cleanup](03-effects-and-cleanup.md) |
| `$cleanup(disposer)` | Register teardown directly during component initialization | [Effects and cleanup](03-effects-and-cleanup.md) |
| `$fetch(target, options?)` | Declare a transparent request payload | [Data](05-data.md) |
| `$read(promise)` | Read an asynchronous result as a transparent value, retaining its replay operation | [Data](05-data.md) |
| `$track(source)` | Observe and control the request behind a source or form | [Data](05-data.md) |
| `$forms(options)` | Declare submission, validation and request state | [Data](05-data.md) |
| `$routed(prepare)` | Prepare data when a matching route is entered | [Route preparation](16-routed.md) |

```tsx
export function Profile() {
  const profile = $fetch<{ name: string }>('/api/profile');
  const request = $track(profile);
  $effect(() => { document.title = profile.name; });
  $cleanup(() => { document.title = 'App'; });
  return <section>
    <h1>{profile.name}</h1>
    <button onClick={() => request.refresh()}>Refresh</button>
  </section>;
}
```

Include `@memoized-dom/compiler/jsx` in TypeScript's `types` list for JSX and
ambient intrinsic declarations. Install `@memoized-dom/data` when using the data
intrinsics. The compiler supplies their runtime imports; request isolation,
transparent reads, form notifications and route preparation retain their normal
semantics. No JavaScript globals are installed.

The compiler's dependency on `@memoized-dom/data` supplies the ambient data
signatures, including overloads and generic inference. This introduces no
dependency version change.

Only these framework names are implicit. An arbitrary `$name` is ordinary
JavaScript. A local declaration, parameter or explicit import shadows the
corresponding intrinsic. `Group`, runtime constructors, router utilities and
types still use ordinary imports. `$effect` and `$cleanup` are compiler-owned
calls, not runtime functions to capture as values.

Unbound `effect` and `cleanup` calls are rejected. Use `$effect` and `$cleanup`.
Explicitly bound names remain ordinary JavaScript; they do not become lifecycle
intrinsics.
