/**
 * @file PlayerControls.tsx
 * Transport controls: prev, play/pause, next.
 * Reads playbackState directly for button affordance logic.
 */
import { playbackState, play, pause, next, prev } from './player-state';

export function PlayerControls() {
  // R27 component-level if prelude
  const isPlaying = playbackState === 'playing';
  let centerIcon  = '';
  let centerLabel = '';
  if (isPlaying) {
    centerIcon  = '⏸';
    centerLabel = 'Pause';
  } else {
    centerIcon  = '▶';
    centerLabel = 'Play';
  }

  return (
    <div class="player-controls">
      <button
        class="ctrl-btn"
        aria-label="Previous track"
        onClick={() => prev()}
      >
        ⏮
      </button>

      <button
        class="ctrl-btn primary-ctrl"
        aria-label={centerLabel}
        onClick={() => {
          if (isPlaying) pause();
          else play();
        }}
      >
        {centerIcon}
      </button>

      <button
        class="ctrl-btn"
        aria-label="Next track"
        onClick={() => next()}
      >
        ⏭
      </button>
    </div>
  );
}
