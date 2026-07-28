/**
 * @file VolumeControl.tsx
 * Volume slider with R28-derived volumeIcon.
 *
 * Key demo: dragging volume from 75→72 does NOT re-render the icon node
 * because volumeIcon (from player-derived.ts) only changes at thresholds:
 * 0, 40, and 70.
 */
import { volume, setVolume } from './player-state';
import { volumeIcon } from './player-derived';

export function VolumeControl() {
  return (
    <div class="volume-control">
      <span class="volume-icon" aria-label="Volume icon">{volumeIcon}</span>

      <input
        class="volume-slider"
        type="range"
        min="0"
        max="100"
        value={volume}
        aria-label="Volume"
        onInput={(e: any) => setVolume(Number(e.target.value))}
      />

      <span class="volume-value">{volume}%</span>
    </div>
  );
}
