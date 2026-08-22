/**
 * Project Store (Plain Class State)
 * 
 * Demonstrates:
 * 1. Plain TypeScript class for domain state management without special base classes or decorators
 * 2. Method-based mutations analyzed and tracked directly by the compiler
 * 3. Collection management and internal filtering
 */

export interface ProjectDeployment {
  id: string;
  name: string;
  environment: 'production' | 'staging' | 'preview';
  branch: string;
  commitHash: string;
  status: 'active' | 'deploying' | 'failed' | 'idle';
  updatedAt: string;
}

export class ProjectStore {
  deployments: ProjectDeployment[] = [
    {
      id: 'dep-1',
      name: 'octopulse-gateway-api',
      environment: 'production',
      branch: 'main',
      commitHash: 'a7b8e1f',
      status: 'active',
      updatedAt: '2m ago',
    },
    {
      id: 'dep-2',
      name: 'auth-service-v2',
      environment: 'staging',
      branch: 'feature/oidc-tokens',
      commitHash: '3d91c44',
      status: 'active',
      updatedAt: '18m ago',
    },
    {
      id: 'dep-3',
      name: 'metrics-collector-worker',
      environment: 'production',
      branch: 'main',
      commitHash: 'f40a92b',
      status: 'idle',
      updatedAt: '1h ago',
    },
    {
      id: 'dep-4',
      name: 'web-dashboard-ui',
      environment: 'preview',
      branch: 'chore/tailwind-v4',
      commitHash: '8e2b01c',
      status: 'active',
      updatedAt: '4m ago',
    },
  ];

  filter: 'all' | 'production' | 'staging' | 'preview' = 'all';

  setFilter(nextFilter: 'all' | 'production' | 'staging' | 'preview') {
    this.filter = nextFilter;
  }

  addDeployment(name: string, environment: 'production' | 'staging' | 'preview', branch: string) {
    const newDep: ProjectDeployment = {
      id: `dep-${Date.now()}`,
      name,
      environment,
      branch,
      commitHash: Math.random().toString(36).substring(2, 9),
      status: 'deploying',
      updatedAt: 'Just now',
    };
    this.deployments.unshift(newDep);

    // Simulate completion after 2.5 seconds
    setTimeout(() => {
      newDep.status = 'active';
    }, 2500);
  }

  triggerRedeploy(id: string) {
    const item = this.deployments.find((d) => d.id === id);
    if (item) {
      item.status = 'deploying';
      item.updatedAt = 'Deploying...';
      setTimeout(() => {
        item.status = 'active';
        item.updatedAt = 'Just now';
      }, 2000);
    }
  }

  removeDeployment(id: string) {
    const index = this.deployments.findIndex((d) => d.id === id);
    if (index !== -1) {
      this.deployments.splice(index, 1);
    }
  }
}

// Export singleton instance of the class
export const projectStore = new ProjectStore();
