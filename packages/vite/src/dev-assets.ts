import { isAbsolute, relative, sep } from 'node:path';
import type { ViteDevServer } from 'vite';

interface DevRoute {
  readonly id: string;
  readonly pattern: string;
  readonly parentId?: string;
}

interface StyleRegistration {
  readonly eager: ReadonlySet<string>;
  readonly routes: readonly {
    readonly id: string;
    readonly styles: ReadonlySet<string>;
  }[];
  readonly routeTree: readonly DevRoute[];
}

const clientStyles = new WeakMap<
  ViteDevServer,
  Map<object, StyleRegistration>
>();

/** Replace the styles owned by one connected compiler graph. */
export function registerClientStyles(
  server: ViteDevServer,
  owner: object,
  eagerStyles: ReadonlySet<string>,
  routeStyles: readonly {
    readonly id: string;
    readonly pattern: string;
    readonly styles: ReadonlySet<string>;
  }[],
  routeTree: readonly DevRoute[],
): void {
  let graphs = clientStyles.get(server);
  if (graphs === undefined) {
    graphs = new Map();
    clientStyles.set(server, graphs);
  }
  graphs.set(owner, {
    eager: new Set(eagerStyles),
    routes: routeStyles.map(route => ({
      id: route.id,
      styles: new Set(route.styles),
    })),
    routeTree: [...routeTree],
  });
}

function routeScore(pattern: string, pathname: string): number[] | null {
  const route = pattern.split('/').filter(Boolean);
  const path = pathname.split('/').filter(Boolean);
  const score: number[] = [];
  for (let index = 0; index < route.length; index++) {
    const segment = route[index]!;
    if (segment === '*') {
      score.push(-1);
      return score;
    }
    if (path[index] === undefined) return null;
    if (segment.startsWith(':')) score.push(1);
    else if (segment === path[index]) score.push(2);
    else return null;
  }
  return route.length === path.length ? score : null;
}

function moreSpecific(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true; // same-path child definitions replace their parent as the leaf
}

function matchedRouteIds(routes: readonly DevRoute[], pathname: string): Set<string> {
  let leaf: DevRoute | undefined;
  let leafScore: number[] = [];
  for (const route of routes) {
    const score = routeScore(route.pattern, pathname);
    if (score === null || (leaf !== undefined && !moreSpecific(score, leafScore))) continue;
    leaf = route;
    leafScore = score;
  }
  const byId = new Map(routes.map(route => [route.id, route]));
  const active = new Set<string>();
  while (leaf !== undefined && !active.has(leaf.id)) {
    active.add(leaf.id);
    leaf = leaf.parentId === undefined ? undefined : byId.get(leaf.parentId);
  }
  return active;
}

function styleUrl(root: string, id: string): string | null {
  const marker = id.search(/[?#]/);
  const file = marker === -1 ? id : id.slice(0, marker);
  const suffix = marker === -1 ? '' : id.slice(marker);
  if (!isAbsolute(file)) return file.startsWith('/') ? `${file}${suffix}` : null;
  const path = relative(root, file);
  if (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) {
    return `/${path.split(sep).join('/')}${suffix}`;
  }
  return `/@fs/${file.replaceAll('\\', '/')}${suffix}`;
}

/** CSS imports discovered by the compiler graph before document streaming. */
export async function clientStyleUrls(
  server: ViteDevServer,
  href = '/',
): Promise<readonly string[]> {
  const graphs = clientStyles.get(server);
  if (graphs === undefined) return [];
  const pathname = new URL(href, 'http://localhost').pathname;
  const urls = new Set<string>();
  for (const registration of graphs.values()) {
    const styles = new Set(registration.eager);
    const active = matchedRouteIds(registration.routeTree, pathname);
    for (const route of registration.routes) {
      if (!active.has(route.id)) continue;
      for (const style of route.styles) styles.add(style);
    }
    for (const style of styles) {
      const url = styleUrl(server.config.root, style);
      if (url !== null) urls.add(url);
    }
  }
  return [...urls].sort();
}
