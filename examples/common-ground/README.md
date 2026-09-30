# Common Ground

A client-side collaboration studio built with memoized-dom. Discover fictional
Ghanaian creatives, assemble a crew, and turn a project brief into a shared
workspace. The blue/yellow palette, bold typography, pill navigation and floating
cards draw inspiration from [Talent Connect Ghana](https://talentconnectgh.com/).
The identity, illustrations, project concept and implementation are original.

## Run

From the repository root:

```sh
bun run example:common-ground
bun run example:common-ground:build
bun run example:common-ground:preview
```

The standalone dev server serves the app at `/`. The shared example server also
serves it at `/common-ground/`. The production build is static HTML, JavaScript,
CSS and local illustrations; it can be hosted without an application server.

## Try the full story

1. Search or filter by discipline. Toggle availability and sort by day rate.
2. Open a collaborator's profile, save someone, and add Ama and Esi to the
   starter crew. Watch the header count, rate and skill coverage update together.
3. Create your own project or choose one of the three starter briefs.
4. Launch the crew to open its workspace. Check off the three milestones.
5. Reload: crew, saved profiles, project and completed milestones stay on this
   browser. Navigation and search are intentionally temporary.
6. Use How it works → Reset this playground to return to the starter state.

All profiles are fictional. No sign-up, network data service or messages are
involved. Browser localStorage is optional; if it is unavailable the app works
in memory. A project can have up to four collaborators. Booked collaborators can
be saved but cannot be added. Budget and missing skills remain visible guidance
rather than blocking a team from launching.

## Composition map

| Module                      | Responsibility / framework feature                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `App.tsx`                   | Component-owned search/filter state, derived collections, conditional screens and caller-owned `renderItem` composition |
| `components/AppShell.tsx`   | Shared shell with a `children` content slot                                                                             |
| `components/ui.tsx`         | Reusable section action/content slots, icons and native dialog wrappers                                                 |
| `components/TalentCard.tsx` | Keyed caller-owned row rendering, nested skill lists, local expandable details and a composed footer slot               |
| `components/CrewPanel.tsx`  | Derived crew, shared module state, keyed member lists, coverage and budget totals, optional footer slot                 |
| `components/Studio.tsx`     | Shared project state, conditional launch/progress presentation and keyed milestone/crew lists                           |
| `components/Dialogs.tsx`    | Native dialogs with keyboard focus management and Escape support; component-local controlled form and validation        |
| `state.ts`                  | Ordinary typed module state, exported mutations, storage restore/persist and cross-component coordination               |
| `data.ts`                   | Seed profiles/briefs and locally bundled original SVG portraits                                                         |
| `main.ts`                   | Restore browser state, import CSS and mount through the public runtime                                                  |

The example uses the compiler and public Vite/runtime packages. There is no React
surface, manually compiled TSX, or application-level subscription graph. Its
forms and views are authored source; Vite compiles the connected module graph.
The existing examples and regression fixtures can evolve independently.
