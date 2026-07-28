/**
 * @file NowPlaying.tsx
 * Shows the currently active track with its R28-derived status badge.
 * Only re-renders when currentIndex or statusLabel changes.
 */
import { TRACKS, currentIndex, play, pause, formatDuration } from './player-state';
import { statusLabel } from './player-derived';

export function NowPlaying() {
  // Component-level const derivation — computed from module state
  const track = TRACKS[currentIndex]!;

  // R27 component-level if prelude:
  // isPlaying drives the button icon without reading statusLabel string methods
  const isPlaying = statusLabel === '▶ Playing';
  let actionIcon  = '';
  let actionLabel = '';
  if (isPlaying) {
    actionIcon  = '⏸';
    actionLabel = 'Pause';
  } else {
    actionIcon  = '▶';
    actionLabel = 'Play';
  }

  return (
    <div class="now-playing-card">
      <div class="track-art">
        <span class="art-emoji">🎵</span>
      </div>

      <div class="track-meta">
        <h2 class="track-title">{track.title}</h2>
        <p class="track-artist">{track.artist}</p>
        <div class="track-duration">{formatDuration(track.duration)}</div>
        <span class="status-badge">{statusLabel}</span>
      </div>

      <button
        class="play-pause-btn"
        aria-label={actionLabel}
        onClick={() => {
          if (isPlaying) pause();
          else play();
        }}
      >
        {actionIcon}
      </button>
    </div>
  );
}
