import { route, navigate } from '@memoized-dom/router';
import type { OrganizationSettings } from '../types';

interface SettingsViewProps {
  settings: OrganizationSettings;
  onUpdateOrgName: (name: string) => void;
  onUpdateEmail: (email: string) => void;
}

export function SettingsView({
  settings,
  onUpdateOrgName,
  onUpdateEmail,
}: SettingsViewProps) {
  const activeSection = route.query.get('section') ?? 'general';

  function switchSection(section: string) {
    navigate('/settings', { query: { section } });
  }

  return (
    <div class="view-panel settings-panel">
      {/* Top Header */}
      <div class="page-title-row">
        <div>
          <h1 class="page-title">Cluster &amp; Organization Settings</h1>
          <p class="page-subtitle">
            Configure cluster topology, API credentials, and administrative contacts
          </p>
        </div>
      </div>

      <div class="settings-grid-layout">
        {/* Settings Sub-Navigation Menu */}
        <aside class="settings-nav-sidebar">
          <button
            class={activeSection === 'general' ? 'settings-nav-item active' : 'settings-nav-item'}
            onClick={() => switchSection('general')}
          >
            🏢 General Profile
          </button>
          <button
            class={activeSection === 'tokens' ? 'settings-nav-item active' : 'settings-nav-item'}
            onClick={() => switchSection('tokens')}
          >
            🔑 API Tokens &amp; Keys
          </button>
          <button
            class={activeSection === 'networking' ? 'settings-nav-item active' : 'settings-nav-item'}
            onClick={() => switchSection('networking')}
          >
            🌐 Anycast Networking
          </button>
          <button
            class={activeSection === 'billing' ? 'settings-nav-item active' : 'settings-nav-item'}
            onClick={() => switchSection('billing')}
          >
            💳 Billing &amp; Ingress SLA
          </button>
        </aside>

        {/* Settings Content Card */}
        <main class="settings-content-card">
          {activeSection === 'general' ? (
            <div class="settings-form-block">
              <h3 class="form-block-title">Organization Profile</h3>
              <p class="form-block-desc">
                Cluster metadata visible on internal dashboards and audit logs.
              </p>

              <div class="input-field-group">
                <label class="input-field-label">Organization Name</label>
                <input
                  class="text-input-field"
                  type="text"
                  value={settings.orgName}
                  onInput={(e: Event) =>
                    onUpdateOrgName((e.target as HTMLInputElement).value)
                  }
                />
              </div>

              <div class="input-field-group">
                <label class="input-field-label">Administrative Contact Email</label>
                <input
                  class="text-input-field"
                  type="email"
                  value={settings.contactEmail}
                  onInput={(e: Event) =>
                    onUpdateEmail((e.target as HTMLInputElement).value)
                  }
                />
              </div>

              <div class="input-field-group">
                <label class="input-field-label">Primary Region</label>
                <input
                  class="text-input-field disabled"
                  type="text"
                  disabled
                  value={settings.clusterRegion}
                />
              </div>
            </div>
          ) : null}

          {activeSection === 'tokens' ? (
            <div class="settings-form-block">
              <h3 class="form-block-title">Service Account API Tokens</h3>
              <p class="form-block-desc">
                High-privilege tokens for CI/CD runners and telemetry collectors.
              </p>

              <div class="token-list-group">
                <div class="token-item-card">
                  <div class="token-meta">
                    <span class="token-title">GitHub Actions Deployer</span>
                    <code class="token-secret font-mono">apex_live_8f92a10...94e1b</code>
                  </div>
                  <span class="tag-status-success">ACTIVE</span>
                </div>

                <div class="token-item-card">
                  <div class="token-meta">
                    <span class="token-title">Prometheus Metric Scraper</span>
                    <code class="token-secret font-mono">apex_metrics_110e5f...32a10</code>
                  </div>
                  <span class="tag-status-success">ACTIVE</span>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === 'networking' ? (
            <div class="settings-form-block">
              <h3 class="form-block-title">Anycast Edge Routing &amp; DDoS Protection</h3>
              <p class="form-block-desc">
                Traffic scrubbing and TLS termination configured across 24 edge points of presence.
              </p>
              <div class="spec-info-card">
                <span class="spec-label">Global Ingress Status</span>
                <span class="spec-value text-emerald">Active &amp; Guarded</span>
                <span class="spec-sub">Automatic BGP Anycast failover enabled</span>
              </div>
            </div>
          ) : null}

          {activeSection === 'billing' ? (
            <div class="settings-form-block">
              <h3 class="form-block-title">Subscription &amp; SLA Quotas</h3>
              <div class="tier-info-card">
                <span class="tier-name">{settings.billingTier}</span>
                <span class="tier-features">Unlimited Ingress • 99.99% Financial SLA • Dedicated Support</span>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
