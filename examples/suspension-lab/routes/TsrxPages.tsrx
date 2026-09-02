import { $fetch } from '@memoized-dom/data';
import { Dashboard } from '../components/Dashboard';
import { AtomicFailure, AtomicPending } from '../components/Feedback';
import { PageIntro } from '../components/PageIntro';
import type { Activity, Metrics, Profile } from '../types';

export function SuspendedTsrxPage() @{
  const profile = $fetch<Profile>('/api/lab/profile?scenario=suspended-tsrx');
  const metrics = $fetch<Metrics>('/api/lab/metrics?scenario=suspended-tsrx');
  const activity = $fetch<Activity>('/api/lab/activity?scenario=suspended-tsrx');

  <section class="page">
    <PageIntro
      eyebrow="TSRX · explicit suspension"
      title="Different syntax, identical readiness."
      description="@try owns the authored policies; suspend still means one atomic initial mount."
      code="@try { <Dashboard suspend {profile} ... /> }"
    />
    @try {
      <Dashboard suspend {profile} {metrics} {activity} frontend="TSRX" mode="Suspended" />
    } @pending {
      <AtomicPending />
    } @catch (error, reset) {
      <AtomicFailure {error} retry={reset} />
    }
  </section>
}

export function ColorlessTsrxPage() @{
  const profile = $fetch<Profile>('/api/lab/profile?scenario=colorless-tsrx');
  const metrics = $fetch<Metrics>('/api/lab/metrics?scenario=colorless-tsrx');
  const activity = $fetch<Activity>('/api/lab/activity?scenario=colorless-tsrx');
  const pendingLabel = 'site waiting';
  const failureLabel = 'Intentional first-attempt failure';

  <section class="page">
    <PageIntro
      eyebrow="TSRX · colorless failure and retry"
      title="Failure stays where the data was needed."
      description="The profile fails once. Metrics and activity continue revealing; reset retries only the failed source."
      code="@try { <Dashboard {profile} ... /> }"
    />
    <p class="failure-note">
      The coral retry chips belong only to profile read sites. Clicking any
      chip retries their one shared source, so every profile field recovers.
    </p>
    @try {
      <Dashboard {profile} {metrics} {activity} frontend="TSRX" mode="Colorless" />
    } @pending {
      <span class="inline-feedback pending-feedback">
        <span class="mini-spinner" /> {pendingLabel}
      </span>
    } @catch (error, reset) {
      <button
        class="inline-feedback error-feedback"
        aria-label={`${failureLabel}: ${error.message}. Retry profile`}
        title={`${failureLabel}: ${error.message}`}
        onClick={reset}
      >
        <span aria-hidden="true">↻</span> Retry
      </button>
    }
  </section>
}
