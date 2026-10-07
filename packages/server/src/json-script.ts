/**
 * Safely serializes a JSON state payload for HTML script-tag embedding.
 * Escapes `<`, `>`, and `&` using Unicode escapes (`\u003c`, `\u003e`, `\u0026`)
 * to prevent premature script block closure or XSS injection (RFC §16.6).
 */
export function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
