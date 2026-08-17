import { route, matchRoutePattern } from '@memoized-dom/router';
import { connectRouter, subscribeRoute } from '@memoized-dom/router/internal';
import { createDataRuntime } from '@memoized-dom/data';
import type {
  CloudService,
  DeployActionInput,
  DeploymentRecord,
  OrganizationSettings,
} from './types';
import {
  initialServices,
  initialDeployments,
  initialOrgSettings,
  mockRouterFetch,
} from './data-store';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { OverviewView } from './views/OverviewView';
import { ServicesView } from './views/ServicesView';
import { ServiceDetailView } from './views/ServiceDetailView';
import { DeploymentsView } from './views/DeploymentsView';
import { SettingsView } from './views/SettingsView';
import { NotFoundView } from './views/NotFoundView';

export function RouterApp() {
  // 1. Reactive Path State synchronized via Router Subscription
  let currentPath = route.pathname;

  effect(() => {
    const disconnect = connectRouter();
    const unsubscribe = subscribeRoute((snapshot) => {
      currentPath = snapshot.pathname;
    });
    return () => {
      unsubscribe();
      disconnect();
    };
  });

  // 2. Data Runtime for REST Operations & Action Mutations
  const dataRuntime = createDataRuntime({
    fetch: mockRouterFetch as typeof fetch,
  });

  const deployAction = dataRuntime.$action<CloudService, DeployActionInput>(
    '/api/deploy',
    { method: 'POST' },
  );

  let servicesState: CloudService[] = [...initialServices];
  let deploymentsState: DeploymentRecord[] = [...initialDeployments];
  let orgSettingsState: OrganizationSettings = { ...initialOrgSettings };
  let isDeploying = false;

  async function handleDeployVersion(serviceId: string, version: string) {
    if (isDeploying) return;
    isDeploying = true;

    const updated = await deployAction({
      serviceId,
      targetVersion: version,
    });

    if (updated) {
      servicesState = servicesState.map((s) =>
        s.id === serviceId ? updated : s,
      );
      deploymentsState = [
        {
          id: `dep-${Date.now().toString().slice(-4)}`,
          serviceId: updated.id,
          serviceName: updated.name,
          version: updated.version,
          commitSha: Math.random().toString(16).slice(2, 9),
          author: 'Current User (Console)',
          timestamp: 'Just now',
          status: 'success',
          duration: '18s',
        },
        ...deploymentsState,
      ];
    }
    isDeploying = false;
  }

  function handleScaleReplicas(serviceId: string, replicas: number) {
    servicesState = servicesState.map((s) =>
      s.id === serviceId ? { ...s, replicas } : s,
    );
  }

  function handleUpdateOrgName(name: string) {
    orgSettingsState = { ...orgSettingsState, orgName: name };
  }

  function handleUpdateEmail(email: string) {
    orgSettingsState = { ...orgSettingsState, contactEmail: email };
  }

  function handleQuickSearch(query: string) {
    if (!query) return;
    const match = servicesState.find((s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.id.toLowerCase().includes(query.toLowerCase()),
    );
    if (match) {
      window.history.pushState(null, '', `/services/${match.id}?tab=overview`);
      currentPath = `/services/${match.id}`;
    }
  }

  // 3. Route Pattern Evaluation against currentPath
  const isOverview = currentPath === '/' || currentPath === '/overview';
  const isServices = currentPath === '/services';
  const serviceDetailMatch = matchRoutePattern('/services/:serviceId', currentPath);
  const isDeployments = currentPath === '/deployments';
  const isSettings = currentPath === '/settings';
  const isNotFound =
    !isOverview &&
    !isServices &&
    serviceDetailMatch === null &&
    !isDeployments &&
    !isSettings;

  return (
    <div class="hyper-console-layout">
      {/* Sleek Navigation Sidebar */}
      <Sidebar currentPath={currentPath} />

      {/* Main Content Area */}
      <div class="hyper-console-main">
        {/* Dynamic Top Bar Header */}
        <TopBar currentPath={currentPath} onQuickSearch={handleQuickSearch} />

        {/* Routed Viewport Outlet */}
        <main class="hyper-viewport-outlet">
          {isOverview ? (
            <OverviewView
              services={servicesState}
              deployments={deploymentsState}
            />
          ) : isServices ? (
            <ServicesView services={servicesState} />
          ) : serviceDetailMatch !== null && serviceDetailMatch.params['serviceId'] ? (
            <ServiceDetailView
              serviceId={serviceDetailMatch.params['serviceId']}
              services={servicesState}
              onDeployVersion={handleDeployVersion}
              onScaleReplicas={handleScaleReplicas}
              isDeploying={isDeploying}
            />
          ) : isDeployments ? (
            <DeploymentsView deployments={deploymentsState} />
          ) : isSettings ? (
            <SettingsView
              settings={orgSettingsState}
              onUpdateOrgName={handleUpdateOrgName}
              onUpdateEmail={handleUpdateEmail}
            />
          ) : isNotFound ? (
            <NotFoundView />
          ) : null}
        </main>
      </div>
    </div>
  );
}
