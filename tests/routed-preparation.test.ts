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
});
