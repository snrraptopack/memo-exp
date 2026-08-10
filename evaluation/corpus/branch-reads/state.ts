export let showingPrimary = true;
export let primary = 1;
export let secondary = 10;

export function toggle(): void { showingPrimary = !showingPrimary; }
export function bumpPrimary(): void { primary++; }
export function bumpSecondary(): void { secondary++; }
