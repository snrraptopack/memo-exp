import { grantWrite, revokeRead } from './helpers';
import { permissions } from './state';

export function enableEditor(): void {
  grantWrite(permissions.editor);
  permissions.dirty = true;
}

export function disableReviewer(): void {
  revokeRead(permissions.reviewer);
  permissions.dirty = true;
}
