/**
 * @file player-derived.ts
 * R28: Module-level exhaustive if/switch derivations.
 *
 * The compiler scans these top-level control-flow blocks,
 * registers each as a computed entity, and links it to its
 * source bindings so downstream components only re-render
 * when the *derived value* actually changes — not on every
 * raw mutation of the source variable.
 */
import { playbackState, volume } from './player-state';

// ─── R28 switch derivation ───────────────────────────────────────────────────
// statusLabel only changes when playbackState crosses state boundaries.
// Components reading statusLabel skip re-renders on volume changes entirely.
export let statusLabel = '';
switch (playbackState) {
  case 'playing':
    statusLabel = '▶ Playing';
    break;
  case 'paused':
    statusLabel = '⏸ Paused';
    break;
  default:
    statusLabel = '⏹ Idle';
    break;
}

// ─── R28 if/else chain derivation ────────────────────────────────────────────
// volumeIcon only changes when volume crosses a threshold (0, 40, 70).
// Dragging volume from 75 → 72 does NOT re-render VolumeControl's icon node.
export let volumeIcon = '';
if (volume === 0) {
  volumeIcon = '🔇';
} else if (volume < 40) {
  volumeIcon = '🔈';
} else if (volume < 70) {
  volumeIcon = '🔉';
} else {
  volumeIcon = '🔊';
}
