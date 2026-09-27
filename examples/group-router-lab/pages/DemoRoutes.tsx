import { Overview } from './Overview';
import { Progressive } from './Progressive';
import { Atomic } from './Atomic';
import { Detail } from './Detail';

/** Component-owned route subtree; App does not declare each page's structure. */
export function DemoRoutes() {
  return <main route="/">
    <Overview route="/" />
    <Progressive route="/progressive/:run" />
    <Atomic route="/atomic/:run" />
    <Detail route="/detail/:id" />
  </main>;
}
