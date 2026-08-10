import { profile as currentProfile, visit as recordVisit } from './state';

export function Header() {
  return <button onClick={() => recordVisit()}>{currentProfile.name}:{currentProfile.visits}</button>;
}
