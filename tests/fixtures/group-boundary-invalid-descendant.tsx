import {
  $fetch,
  Error as ErrorArm,
  Group,
  Pending,
} from '@memoized-dom/data';

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
    <Group>
      <Pending component={Loading} />
      <ErrorArm component={Failed} />
      <ChildOwnsTheOnlySource suspend />
    </Group>
  );
}
