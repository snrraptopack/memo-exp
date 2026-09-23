import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PARAMETER_SEGMENT = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;

/** Generated route registry location: `<root>/.memoized/routes.d.ts`. */
export function routesDeclarationFile(root: string): string {
  return resolve(root, '.memoized', 'routes.d.ts');
}

function routeParameters(pattern: string): string[] {
  const parameters: string[] = [];
  for (const segment of pattern.split('/')) {
    const named = PARAMETER_SEGMENT.exec(segment)?.[1];
    if (named !== undefined) {
      parameters.push(named);
    } else if (segment === '*') {
      parameters.push('*');
    }
  }
  return parameters;
}

function routeEntry(pattern: string): string {
  const parameters = routeParameters(pattern);
  const input = parameters.length === 0
    ? '{}'
    : `{ ${parameters
        .map(name => `${JSON.stringify(name)}: string | number | boolean | bigint`)
        .join('; ')} }`;
  const params = parameters.length === 0
    ? '{}'
    : `{ ${parameters
        .map(name => `${JSON.stringify(name)}: string`)
        .join('; ')} }`;
  return `    ${JSON.stringify(pattern)}: { input: ${input}; params: ${params}; };`;
}

/**
 * Write `.memoized/routes.d.ts`, augmenting the router's open `RouteTable`
 * with the application's expanded route patterns. No-op when unchanged so
 * dependent watchers are not invalidated by identical rewrites.
 */
export async function writeRoutesDeclaration(
  root: string,
  patterns: readonly string[],
): Promise<void> {
  const output = routesDeclarationFile(root);
  const entries = [...new Set(patterns)].sort().map(routeEntry).join('\n');
  const content = `declare module '@memoized-dom/router' {
  interface RouteTable {
${entries}
  }
}

export {};
`;
  const previous = await readFile(output, 'utf8').catch(() => undefined);
  if (previous !== content) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content);
  }
}
