import {
  $fetch,
  $track,
  Error as ErrorArm,
  Group,
  Pending,
} from '@memoized-dom/data';

interface User {
  name: string;
}

interface Summary {
  text: string;
}

function OuterPending() {
  return <i class="outer-pending">Outer pending</i>;
}

function OuterError({
  error,
  retry,
}: {
  error: { message: string };
  retry: () => void;
}) {
  return <button class="outer-error" onClick={retry}>{error.message}</button>;
}

function InnerPending() {
  return <i class="inner-pending">Inner pending</i>;
}

function InnerError({
  error,
  retry,
}: {
  error: { message: string };
  retry: () => void;
}) {
  return <button class="inner-error" onClick={retry}>{error.message}</button>;
}

function UserChild({ user, id }: { user: User; id: string }) {
  return <article id={id}>{user.name}</article>;
}

/**
 * A is mounted normally. A and suspended B consume the same A-owned source.
 * B's suspension must not withhold A or A's independent consumption site.
 */
export function SharedSourceChildSuspended() {
  const user = $fetch<User>('/matrix/shared-user');

  return (
    <Group>
      <Pending component={OuterPending} />
      <ErrorArm component={OuterError} />
      <section id="shared-a-shell">
        <h1>A mounted</h1>
        <output id="shared-a-value">{user.name}</output>
        <Group>
          <Pending component={InnerPending} />
          <ErrorArm component={InnerError} />
          <UserChild suspend user={user} id="shared-b" />
        </Group>
      </section>
    </Group>
  );
}

/**
 * A owns two sources. Its ordinary site and suspended B are independent, so
 * resolving B first must mount B while A's other site is still pending.
 */
export function IndependentChildSuspended() {
  const summary = $fetch<Summary>('/matrix/independent-summary');
  const details = $fetch<User>('/matrix/independent-details');

  return (
    <Group>
      <Pending component={OuterPending} />
      <ErrorArm component={OuterError} />
      <section id="independent-a-shell">
        <output id="independent-a-value">{summary.text}</output>
        <Group>
          <Pending component={InnerPending} />
          <ErrorArm component={InnerError} />
          <UserChild suspend user={details} id="independent-b" />
        </Group>
      </section>
    </Group>
  );
}

function NormalChild({ user }: { user: User }) {
  return <article id="parent-suspended-b">{user.name}</article>;
}

function NormalParent({ user }: { user: User }) {
  return (
    <section id="parent-suspended-a">
      <h1>A mounted</h1>
      <NormalChild user={user} />
    </section>
  );
}

/** Parent suspends component A; B is normal but cannot mount before A. */
export function ParentSuspendsComponent() {
  const user = $fetch<User>('/matrix/parent-suspended-user');

  return (
    <Group>
      <Pending component={OuterPending} />
      <ErrorArm component={OuterError} />
      <NormalParent suspend user={user} />
    </Group>
  );
}

function SelfSuspendingChild({ user }: { user: User }) {
  return (
    <section id="self-suspending-b-shell">
      <h2>B mounted</h2>
      <Group>
        <Pending component={InnerPending} />
        <ErrorArm component={InnerError} />
        <article suspend id="self-suspending-b-value">{user.name}</article>
      </Group>
    </section>
  );
}

/** A mounts B normally; B places its own suspended element around A's data. */
export function ChildSuspendsOwnElement() {
  const user = $fetch<User>('/matrix/self-suspending-user');

  return (
    <section id="self-suspending-a-shell">
      <h1>A mounted</h1>
      <SelfSuspendingChild user={user} />
    </section>
  );
}

function ChildOwnedRequest() {
  const user = $fetch<User>('/matrix/waterfall-child');

  return (
    <section id="waterfall-b-shell">
      <h2>B mounted</h2>
      <Group>
        <Pending component={InnerPending} />
        <ErrorArm component={InnerError} />
        <article suspend id="waterfall-b-value">{user.name}</article>
      </Group>
    </section>
  );
}

function SuspendedParentWithChildRequest({ user }: { user: User }) {
  return (
    <section id="waterfall-a-shell">
      <output>{user.name}</output>
      <ChildOwnedRequest />
    </section>
  );
}

/**
 * B owns its request. Because suspended A is not invoked yet, B's request is
 * deliberately not created until A's source commits and A mounts.
 */
export function SuspendedParentCreatesWaterfall() {
  const user = $fetch<User>('/matrix/waterfall-parent');

  return (
    <Group>
      <Pending component={OuterPending} />
      <ErrorArm component={OuterError} />
      <SuspendedParentWithChildRequest suspend user={user} />
    </Group>
  );
}

/** A committed suspended region stays mounted for refresh, but not rebind. */
export function SuspendedRefreshAndRebind() {
  let version = 'one';
  const user = $fetch<User>(`/matrix/rebind/${version}`);
  const request = $track(user);

  return (
    <main id="rebind-shell">
      <button id="refresh-source" onClick={() => {
        void request.refresh();
      }}>Refresh</button>
      <button id="rebind-source" onClick={() => {
        version = 'two';
      }}>Rebind</button>
      <Group>
        <Pending component={OuterPending} />
        <ErrorArm component={OuterError} />
        <article suspend id="rebind-value">{user.name}</article>
      </Group>
    </main>
  );
}

function MultiError({
  error,
  retry,
}: {
  error: { status: number | null };
  retry: () => void;
}) {
  return (
    <button class="multi-error" onClick={retry}>
      Failed {error.status}
    </button>
  );
}

/** A single suspended gate with two independently failing prerequisites. */
export function MultipleFailureSuspended() {
  const left = $fetch<User>('/matrix/failure-left');
  const right = $fetch<User>('/matrix/failure-right');

  return (
    <Group>
      <Pending component={OuterPending} />
      <ErrorArm component={MultiError} />
      <section suspend id="multi-value">{left.name}:{right.name}</section>
    </Group>
  );
}

function ColorlessPrivateChild() {
  const user = $fetch<User>('/matrix/mixed-child');
  return <article id="mixed-child">{user.name}</article>;
}

/**
 * The suspended gate can see only the parent source. After it opens, the
 * child-owned source follows the ordinary colorless behavior unless B adds a
 * Group of its own.
 */
export function SuspendedParentWithColorlessChild() {
  const user = $fetch<User>('/matrix/mixed-parent');

  return (
    <Group>
      <Pending component={OuterPending} />
      <ErrorArm component={OuterError} />
      <section suspend id="mixed-parent">
        <output>{user.name}</output>
        <ColorlessPrivateChild />
      </section>
    </Group>
  );
}
