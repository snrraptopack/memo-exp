One known trade-off documented in the commit: a non-volatile keyed list whose rows are mutated via a
 component-level helper won't row-refresh on its own (previously it crashed; now it's simply not
 row-routed) — if that pattern matters, the follow-up is folding helper writes into the caller's scope.
 Also remember the theme "issue" was app-level: components hardcode stone-* classes, so [data-theme]
 variables have nothing to restyle.
