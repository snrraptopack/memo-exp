import { ExternalLibraryApp } from './ExternalLibraryApp';
import './styles.css';

const root = document.getElementById('root');
if (root !== null) {
  const factory = ExternalLibraryApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  root.appendChild(factory('ExternalLibraryApp', null));
}
