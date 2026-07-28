/**
 * @file player-state.ts
 * Module-level plain state and actions for the music player.
 * No signals, no stores — just plain let variables.
 */

export interface Track {
  id: number;
  title: string;
  artist: string;
  duration: number; // seconds
}

export type PlaybackState = 'idle' | 'playing' | 'paused';

export const TRACKS: Track[] = [
  { id: 1, title: 'Neon Drift',           artist: 'Synthwave Collective', duration: 214 },
  { id: 2, title: 'Midnight Circuit',     artist: 'Lo-Fi Lab',            duration: 187 },
  { id: 3, title: 'Aurora Protocol',      artist: 'Chillhop Studio',      duration: 253 },
  { id: 4, title: 'Crystal Frequencies',  artist: 'Ambient Co.',          duration: 198 },
  { id: 5, title: 'Stellar Drift',        artist: 'Future Bass',          duration: 221 },
];

// Module-level plain state
export let currentIndex: number     = 0;
export let playbackState: PlaybackState = 'idle';
export let volume: number           = 75;

// Mutations — plain functions, no special wrappers
export function play()  { playbackState = 'playing'; }
export function pause() { playbackState = 'paused';  }

export function next() {
  currentIndex = (currentIndex + 1) % TRACKS.length;
  playbackState = 'playing';
}

export function prev() {
  currentIndex = (currentIndex - 1 + TRACKS.length) % TRACKS.length;
  playbackState = 'playing';
}

export function selectTrack(index: number) {
  currentIndex  = index;
  playbackState = 'playing';
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(100, v));
}

// Pure utility — not reactive
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
