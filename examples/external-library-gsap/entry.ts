import './styles.css';
import { GsapExternalApp } from './GsapExternalApp';

const root = document.getElementById('root');
if (root !== null) {
  const factory = GsapExternalApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  root.appendChild(factory('GsapExternalApp', null));
}
