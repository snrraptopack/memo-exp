export function grantWrite(role: { write: boolean }): void {
  role.write = true;
}

export function revokeRead(role: { read: boolean }): void {
  role.read = false;
}
