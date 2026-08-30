import { $track, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { currentUser, notifications } from './session';

function UserBadge() {
  return (
    <span class="badge">
      <span class="avatar">{currentUser.name.charAt(0)}</span>
      <span class="who">
        <strong>{currentUser.name}</strong>
        <small>{currentUser.email}</small>
      </span>
    </span>
  );
}

function NotificationsPanel() {
  const state = $track(notifications);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Notifications</h2>
        <span class={{ pill: true, busy: state.refreshing }}>{unread} unread</span>
      </div>

      <Group data={notifications}>
        <Pending component={Skeleton} />
        <ErrorArm component={ErrorRow} />
        <ul class="list">
          {notifications.map((n) => (
            <li key={n.id} class={n.read ? 'row read' : 'row unread'}>
              <span>{n.text}</span>
              {!n.read && (
                <button
                  class="tiny"
                  onClick={() => {
                    n.read = true;
                  }}
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      </Group>
    </section>
  );
}

function Skeleton() {
  return (
    <ul class="list">
      <li class="row skeleton">▒▒▒▒▒▒▒▒</li>
      <li class="row skeleton">▒▒▒▒▒▒</li>
    </ul>
  );
}

function ErrorRow({ error, retry }: { error: { message: string }; retry: () => void }) {
  return (
    <ul class="list">
      <li class="row error">
        {error.message}
        <button class="tiny" onClick={retry}>Retry</button>
      </li>
    </ul>
  );
}

export function WorkspaceApp() {
  return (
    <main class="workspace">
      <header class="top">
        <h1>Workspace</h1>
        <UserBadge />
      </header>
      <NotificationsPanel />
      <p class="hint">
        Module-scope sources + colorless reads. Ordinary object writes update
        the exact dependent UI.
      </p>
    </main>
  );
}
