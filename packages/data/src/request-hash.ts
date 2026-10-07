interface IdentityHash {
  left: number;
  right: number;
  length: number;
}

export function createIdentityHash(): IdentityHash {
  return { left: 0x811c9dc5, right: 0x9e3779b9, length: 0 };
}

export function updateIdentityHash(hash: IdentityHash, value: number): void {
  hash.left = Math.imul(hash.left ^ value, 0x01000193);
  hash.right = Math.imul(hash.right ^ value, 0x85ebca6b) + 0xc2b2ae35;
  hash.length++;
}

export function updateTextHash(hash: IdentityHash, value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    updateIdentityHash(hash, unit & 0xff);
    updateIdentityHash(hash, unit >>> 8);
  }
}

export function finishIdentityHash(kind: string, hash: IdentityHash): string {
  return `${kind}:${hash.length}:${(hash.left >>> 0).toString(36)}:${(hash.right >>> 0).toString(36)}`;
}

export function textIdentity(kind: string, value: string): string {
  const hash = createIdentityHash();
  updateTextHash(hash, value);
  return finishIdentityHash(kind, hash);
}

export function bytesIdentity(bytes: Uint8Array): string {
  const hash = createIdentityHash();
  for (const byte of bytes) updateIdentityHash(hash, byte);
  return finishIdentityHash('bytes', hash);
}
