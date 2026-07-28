/**
 * @file MusicApp.tsx
 * Root component composing NowPlaying, PlayerControls, VolumeControl,
 * and TrackList. Hosts a value-guarded effect that only fires when the
 * active track actually changes — play/pause and volume do NOT trigger it.
 */
import { TRACKS, currentIndex } from './player-state';
import { NowPlaying }     from './NowPlaying';
import { PlayerControls } from './PlayerControls';
import { VolumeControl }  from './VolumeControl';
import { TrackList }      from './TrackList';

export function MusicApp() {
  // Component-level const derivation: track identity for the effect guard
  const currentTrackTitle = TRACKS[currentIndex]?.title ?? "unknown";

  // Value-guarded effect: fires ONLY when the active track changes.
  // play(), pause(), and setVolume() do not trigger this.
  effect(() => {
    console.log('[MusicApp] Now playing:', currentTrackTitle);
  });

  return (
    <div class="music-app">
      <header class="music-header">
        <h1>🎵 Memoized DOM Player</h1>
        <p class="music-subtitle">
          Showcasing <strong>R28 Module-Level Derivations</strong> and
          deep component composition
        </p>
      </header>

      <div class="music-layout">
        <div class="music-left">
          <NowPlaying />
          <PlayerControls />
          <VolumeControl />
        </div>

        <div class="music-right">
          <TrackList />
        </div>
      </div>
    </div>
  );
}
