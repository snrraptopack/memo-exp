import { $fetch, Group } from '@memoized-dom/data';

function Loading() {
  return <i>Loading</i>;
}

function Failed({ retry }: { retry: () => void }) {
  return <button onClick={retry}>Retry</button>;
}

function ChildOwnsTheOnlySource() {
  const user = $fetch<{ name: string }>('/matrix/invalid-child');
  return <article>{user.name}</article>;
}

export function InvalidParentSuspension() {
  return (
    <Group pending={Loading} error={Failed}>
      <ChildOwnsTheOnlySource suspend />
    </Group>
  );
}
