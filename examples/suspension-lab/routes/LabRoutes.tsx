import { ColorlessTsxPage } from './ColorlessTsxPage';
import { OverviewPage } from './OverviewPage';
import { SuspendedTsxPage } from './SuspendedTsxPage';
import { ColorlessTsrxPage, SuspendedTsrxPage } from './TsrxPages.tsrx';

function NotFoundPage() {
  return (
    <section class="page not-found">
      <p class="eyebrow">Route not found</p>
      <h1>This experiment is not on the bench.</h1>
      <a class="primary-link" route-to="/">Return to the lab</a>
    </section>
  );
}

/** This linked component owns the complete route subtree, not the root file. */
export function LabRoutes() {
  return (
    <main class="lab-main" route="/">
      <OverviewPage route="/" />
      <ColorlessTsxPage route="/colorless-tsx" />
      <SuspendedTsxPage route="/suspended-tsx" />
      <SuspendedTsrxPage route="/suspended-tsrx" />
      <ColorlessTsrxPage route="/colorless-tsrx" />
      <NotFoundPage route="/*" />
    </main>
  );
}
