import type { Activity, Metrics, Profile } from '../types';

interface DashboardProps {
  profile: Profile;
  metrics: Metrics;
  activity: Activity;
  frontend: 'TSX' | 'TSRX';
  mode: 'Colorless' | 'Suspended';
}

export function Dashboard({ profile, metrics, activity, frontend, mode }: DashboardProps) {
  return (
    <article class="dashboard-card">
      <div class="dashboard-static-bar">
        <span class="live-dot" />
        <span>Static shell mounted</span>
        <span class="mode-chip">{frontend} · {mode}</span>
      </div>
      <header class="profile-row">
        <div class="avatar">{profile.initials}</div>
        <div>
          <p class="micro-label">On-call owner</p>
          <h2>{profile.name}</h2>
          <p class="muted-line">{profile.role} · {profile.region}</p>
        </div>
      </header>
      <div class="metric-grid">
        <div class="metric-card"><span>Availability</span><strong>{metrics.availability}</strong></div>
        <div class="metric-card"><span>Requests / day</span><strong>{metrics.requests}</strong></div>
        <div class="metric-card"><span>P95 latency</span><strong>{metrics.latency}</strong></div>
      </div>
      <footer class="activity-row">
        <div><p class="micro-label">Latest deployment</p><strong>{activity.latestDeploy}</strong></div>
        <div><p class="micro-label">Environment</p><strong>{activity.environment}</strong></div>
        <span class="health-pill">{activity.status}</span>
      </footer>
    </article>
  );
}
