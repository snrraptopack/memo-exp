/**
 * @file TrackList.tsx
 * Renders all tracks, passing isActive down to each TrackItem.
 * Only re-renders when currentIndex changes — not on play/pause or volume.
 */
import { TRACKS, currentIndex } from './player-state';
import { TrackItem } from './TrackItem';

export function TrackList() {
  return (
    <div class="track-list">
      <h3 class="track-list-heading">Queue</h3>
      {TRACKS.map((track, i) => (
        <TrackItem
          track={track}
          index={i}
          isActive={currentIndex === i}
        />
      ))}
    </div>
  );
}
