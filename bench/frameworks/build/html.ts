/**
 * @file html.ts
 * Writes one minimal document per isolated production framework bundle.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function writeAdapterHtml(root: string, id: string): void {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>.completed{text-decoration:line-through}</style>
</head>
<body>
  <bench-root id="app"></bench-root>
  <script src="./${id}.js"></script>
</body>
</html>
`;
  writeFileSync(resolve(root, `dist/${id}.html`), html, 'utf8');
}
