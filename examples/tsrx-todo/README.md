# Experimental TSRX todo

This example uses the normal shared Memoized DOM Vite adapter with a `.tsrx`
component. It demonstrates statement-container function bodies, nested `@if`,
keyed `@for`, `index`, loop-local setup, and `@empty`.

Run it from the repository root:

```bash
bun run example:tsrx
```

Then open `http://localhost:5173/tsrx-todo/`.

Styles live in `styles.css` because TSRX scoped `<style>` blocks are not supported
until Memoized DOM defines a CSS output and scoping contract.
