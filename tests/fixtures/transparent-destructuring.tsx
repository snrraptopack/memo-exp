import { $fetch } from '@memoized-dom/data';

interface Profile {
  name: string;
  address: { city: string };
  tags: string[];
  missing?: string;
}

export function App() {
  const profile = $fetch<Profile>('/profile');
  const alias = profile;
  const {
    name: displayName,
    address: { city },
    tags: [firstTag, ...otherTags],
    missing = 'fallback',
  } = alias;

  return (
    <main>
      <span id="name">{displayName}</span>
      <span id="city">{city}</span>
      <span id="first-tag">{firstTag}</span>
      <span id="other-tags">{otherTags.join(',')}</span>
      <span id="missing">{missing}</span>
      <button onClick={() => {
        profile.name = 'Grace';
      }}>Rename</button>
    </main>
  );
}
