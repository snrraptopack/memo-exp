import { $fetch, Error, Group, Pending } from '@memoized-dom/data';
import { Dashboard } from '../components/Dashboard';
import { LocalFailure, LocalPending } from '../components/Feedback';
import { PageIntro } from '../components/PageIntro';
import type { Activity, Metrics, Profile } from '../types';

export function ColorlessTsxPage() {
  const profile = $fetch<Profile>('/api/lab/profile?scenario=colorless-tsx');
  const metrics = $fetch<Metrics>('/api/lab/metrics?scenario=colorless-tsx');
  const activity = $fetch<Activity>('/api/lab/activity?scenario=colorless-tsx');
  return (
    <section class="page">
      <PageIntro eyebrow="TSX · normal colorless mode" title="The useful shell does not wait." description="Watch the card mount immediately, then replace only the exact fields unlocked by each response." code="<Dashboard profile={profile} ... />" />
      <Group data={{ profile, metrics, activity }}>
        <Pending component={LocalPending} />
        <Error component={LocalFailure} />
        <Dashboard profile={profile} metrics={metrics} activity={activity} frontend="TSX" mode="Colorless" />
      </Group>
    </section>
  );
}
