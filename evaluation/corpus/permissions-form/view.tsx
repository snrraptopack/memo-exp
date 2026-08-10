import { disableReviewer, enableEditor } from './actions';
import { permissions } from './state';

export function PermissionsForm() {
  return <form><button onClick={() => enableEditor()}>editor</button><button onClick={() => disableReviewer()}>reviewer</button><output>{permissions.editor.write}:{permissions.reviewer.read}:{permissions.dirty}</output></form>;
}
