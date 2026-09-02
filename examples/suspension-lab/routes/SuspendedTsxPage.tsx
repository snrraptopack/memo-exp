import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
import { Dashboard } from '../components/Dashboard';
import { AtomicFailure, AtomicPending } from '../components/Feedback';
import { PageIntro } from '../components/PageIntro';
import type { Activity, Metrics, Profile } from '../types';

export function SuspendedTsxPage() {
  const profile = $fetch<Profile>('/api/lab/profile?scenario=suspended-tsx');
  const metrics = $fetch<Metrics>('/api/lab/metrics?scenario=suspended-tsx');
  const activity = $fetch<Activity>('/api/lab/activity?scenario=suspended-tsx');
  return (
    <section class="page">
      <PageIntro eyebrow="TSX · explicit suspension" title="The dashboard arrives as one composition." description="The Group owns one pending panel until the slowest initial source commits." code="<Dashboard suspend profile={profile} ... />" />
      <Group data={{ profile, metrics, activity }}>
        <Pending component={AtomicPending} />
        <Error component={AtomicFailure} />
        <Dashboard suspend profile={profile} metrics={metrics} activity={activity} frontend="TSX" mode="Suspended" />
      </Group>
    </section>
  );
}
