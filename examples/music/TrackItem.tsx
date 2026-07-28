/**
 * @file TrackItem.tsx
 * A single row in the track list.
 * isActive is passed as a prop — TrackItem itself never reads module state.
 */
import { selectTrack, formatDuration } from './player-state';
import type { Track } from './player-state';

export interface TrackItemProps {
  track: Track;
  index: number;
  isActive: boolean;
}

export function TrackItem({ track, index, isActive }: TrackItemProps) {
  // R27 component-level if prelude
  let rowClass = 'track-item';
  if (isActive) rowClass = 'track-item active';

  let indicator = '';
  if (isActive) indicator = '▶';
  else indicator = `${index + 1}`;

  return (
    <div class={rowClass} onClick={() => selectTrack(index)}>
      <span class="track-indicator">{indicator}</span>

      <div class="track-item-meta">
        <span class="track-item-title">{track.title}</span>
        <span class="track-item-artist">{track.artist}</span>
      </div>

      <span class="track-item-duration">{formatDuration(track.duration)}</span>
    </div>
  );
}
