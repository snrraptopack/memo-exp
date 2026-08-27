import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { session } from '../session';
import { AvatarSkeleton, ErrorFallback } from '../components/Skeletons';

export let usernameInput = 'Ada Lovelace';
export let emailInput = 'ada@workspace.dev';
export let savedStatus = '';

export function SettingsRoute() {
  return (
    <div class="route-container settings-page">
      <div class="page-header">
        <div class="page-title">
          <h2>Application & Runtime Settings</h2>
          <p class="subtitle">Manage user profile, runtime environment, and hydration policies.</p>
        </div>
      </div>

      <section class="section-card">
        <div class="section-card-header">
          <h3>👤 User Profile</h3>
        </div>

        <Group data={session}>
          <Pending component={AvatarSkeleton} />
          <ErrorArm component={ErrorFallback} />
          <div class="profile-summary">
            <span class="profile-avatar">{session.avatar}</span>
            <div class="profile-details">
              <strong>{session.name}</strong>
              <span>{session.role}</span>
              <small>{session.email}</small>
            </div>
          </div>
        </Group>

        <form
          class="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            savedStatus = '✅ Settings saved successfully at ' + new Date().toLocaleTimeString();
          }}
        >
          <div class="form-group">
            <label>Display Name</label>
            <input
              class="form-input"
              value={usernameInput}
              onInput={(e) => {
                usernameInput = (e.target as HTMLInputElement).value;
              }}
            />
          </div>

          <div class="form-group">
            <label>Notification Email</label>
            <input
              class="form-input"
              value={emailInput}
              onInput={(e) => {
                emailInput = (e.target as HTMLInputElement).value;
              }}
            />
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            {savedStatus !== '' && <span class="status-msg">{savedStatus}</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
