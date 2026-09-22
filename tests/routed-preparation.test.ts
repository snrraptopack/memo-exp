import { describe, expect, it } from 'vitest';
import {
  compileModules,
  compileModulesDetailed,
} from '@memoized-dom/compiler';

describe('$routed preparation discovery', () => {
  it('records universal context usage without generating a server classification', () => {
    const compiled = compileModulesDetailed({
      './ReportPage.tsx': `
        import { $routed } from '@memoized-dom/router';

        function loadReport(id: string) {
          return { id, title: 'Compiler-owned preparation' };
        }

        export function ReportPage() {
          const page = $routed(({ state, params, query, signal }) =>
            loadReport(params.reportId)
          );
          return <h1>{page.title}</h1>;
        }
      `,
    });

    expect(compiled.metadata['./ReportPage.tsx']!.routedPreparations).toEqual([
      expect.objectContaining({
        id: './ReportPage.tsx#routed:ReportPage:0',
        moduleId: './ReportPage.tsx',
        component: 'ReportPage',
        binding: 'page',
        contextFields: ['state', 'params', 'query', 'signal'],
        server: false,
      }),
    ]);
  });

  it('classifies normal server context fields as a server-backed preparation', () => {
    const compiled = compileModulesDetailed({
      './AdminPage.tsx': `
        import { $routed, redirectRoute } from '@memoized-dom/router';

        export function AdminPage() {
          const page = $routed(({ state, params, request, locals, services, platform }) => {
            if (!locals.user) return redirectRoute('/login');
            return services.admin.load(params.section, request, platform);
          });
          return <h1>{page.title}</h1>;
        }
      `,
    });

    expect(compiled.metadata['./AdminPage.tsx']!.routedPreparations).toEqual([
      expect.objectContaining({
        component: 'AdminPage',
        contextFields: [
          'state',
          'params',
          'request',
          'locals',
          'services',
          'platform',
        ],
        server: true,
      }),
    ]);
  });

  it('requires a direct component-local const and an inline synchronous callback', () => {
    expect(() => compileModules({
      './module.ts': `
        import { $routed } from '@memoized-dom/router';
        const page = $routed(({ state, params }) => params.id);
      `,
    })).toThrow(/\$routed must be declared directly in a component/);

    expect(() => compileModules({
      './Page.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function Page() {
          let page = $routed(({ state, params }) => params.id);
          return <p>{page}</p>;
        }
      `,
    })).toThrow(/assign \$routed directly to a component-local const binding/);

    expect(() => compileModules({
      './AsyncPage.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function AsyncPage() {
          const page = $routed(async ({ state, params }) => params.id);
          return <p>{page}</p>;
        }
      `,
    })).toThrow(/return service or server-function work without authoring async\/await/);
  });

  it('rejects context rest bindings because they hide server capability use', () => {
    expect(() => compileModules({
      './Page.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function Page() {
          const page = $routed(({ params, ...context }) => params.id);
          return <p>{page}</p>;
        }
      `,
    })).toThrow(/context does not support a rest binding/);
  });

  it('lowers the component read and omits server callback bodies from client output', () => {
    const client = compileModules({
      './App.tsx': `
        import { $routed } from '@memoized-dom/router';

        export function AdminPage() {
          const page = $routed(({ params, services }) =>
            services.admin.load(params.section)
          );
          return <h1>{page.title}</h1>;
        }

        function App() {
          return <AdminPage route="/admin/:section" />;
        }

      `,
    }, { routedEnvironment: 'client' })['./App.tsx']!;

    expect(client).toContain('registerRoutedPreparation');
    expect(client).toContain('readRoutedPreparation');
    expect(client).toContain('preparations: ["./App.tsx#routed:AdminPage:0"]');
    expect(client).not.toContain('services.admin.load');

    const server = compileModules({
      './App.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function AdminPage() {
          const page = $routed(({ params, services }) =>
            services.admin.load(params.section)
          );
          return <h1>{page.title}</h1>;
        }
        function App() { return <AdminPage route="/admin/:section" />; }
      `,
    }, { routedEnvironment: 'server' })['./App.tsx']!;

    expect(server).toContain('services.admin.load');
  });

  it('rejects component-instance captures before hoisting preparation', () => {
    expect(() => compileModules({
      './Page.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function Page(props: { tenant: string }) {
          const page = $routed(({ params }) => props.tenant + params.id);
          return <p>{page}</p>;
        }
      `,
    })).toThrow(/cannot capture component-instance binding 'props'/);
  });

  it('classifies callback-confined #server imports and erases them from client output', () => {
    const compiled = compileModulesDetailed({
      './Page.tsx': `
        import { $routed } from '@memoized-dom/router';
        import { reports } from '#server/reports';
        export function Page() {
          const page = $routed(({ params }) => reports.load(params.id));
          return <p>{page.title}</p>;
        }
      `,
    }, { routedEnvironment: 'client' });

    expect(
      compiled.metadata['./Page.tsx']!.routedPreparations[0],
    ).toMatchObject({ server: true, contextFields: ['params'] });
    expect(compiled.output['./Page.tsx']).not.toContain('#server/reports');
    expect(compiled.output['./Page.tsx']).not.toContain('reports.load');
  });

  it('attaches preparation IDs through an imported route component callsite', () => {
    const compiled = compileModules({
      './App.tsx': `
        import { ReportPage } from './ReportPage';
        export function App() {
          return <ReportPage route="/reports/:reportId" />;
        }
      `,
      './ReportPage.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function ReportPage() {
          const page = $routed(({ params }) => ({ id: params.reportId }));
          return <p>{page.id}</p>;
        }
      `,
    });

    expect(compiled['./App.tsx']).toContain(
      'preparations: ["./ReportPage.tsx#routed:ReportPage:0"]',
    );
  });

  it('rejects preparations whose component is not attached to a route in an application graph', () => {
    expect(() => compileModules({
      './main.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { App } from './App';
        mount('root', App);
      `,
      './App.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function App() {
          const page = $routed(({ services }) => services.reports.load());
          return <main>{page.title}</main>;
        }
      `,
    })).toThrow(/\$routed in component 'App' is never prepared/);
  });

  it('still compiles unattached preparations in standalone module graphs without a mount', () => {
    const compiled = compileModulesDetailed({
      './Page.tsx': `
        import { $routed } from '@memoized-dom/router';
        export function Page() {
          const page = $routed(({ params }) => params.id);
          return <p>{page}</p>;
        }
      `,
    });
    expect(compiled.metadata['./Page.tsx']!.routedPreparations).toHaveLength(1);
  });

  it('emits the existing data-resource settler for colorless preparation results', () => {
    const compiled = compileModules({
      './Page.tsx': `
        import { $routed } from '@memoized-dom/router';
        import { $fetch } from '@memoized-dom/data';
        export function Page() {
          const page = $routed(({ params }) =>
            $fetch('/api/reports/' + params.id)
          );
          return <p>{page.title}</p>;
        }
      `,
    })['./Page.tsx']!;

    expect(compiled).toContain('settle: _MDD.settleRoutedValue');
  });
});
