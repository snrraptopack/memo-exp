# React assimilation tests

Run this suite separately with `bun run test:react`. The normal root Vitest
configuration excludes `react-tests/`.

`fixture/` contains source files as a package author and an MMD app would write
them. Put a local package under `fixture/<package-name>/`, import it by its bare
name from an app fixture, and add the name to `compileFixture({ packages: [...] })`.
The harness collects the reachable files, calls `compileModules` with real
module identities, emits the linked graph under the ignored `out/` directory,
and lets tests import and mount the result in happy-dom. Only listed package
identities enter the React source dialect; application files stay MMD. A
selected installed npm package can use the same `packages` list; its files resolve from
`node_modules`.

Assert the emitted translation and the chosen **MMD behavior**. DOM tests
should cover updates, independent instances, cleanup, and ownership where the
package needs them. A package passing source recognition alone is not a claim
that it works in the DOM.
