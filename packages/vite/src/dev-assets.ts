import { isAbsolute, relative, sep } from 'node:path';
import type { ViteDevServer } from 'vite';

const clientStyles = new WeakMap<
  ViteDevServer,
  Map<object, Set<string>>
>();

/** Replace the styles owned by one connected compiler graph. */
export function registerClientStyles(
  server: ViteDevServer,
  owner: object,
  styles: ReadonlySet<string>,
): void {
  let graphs = clientStyles.get(server);
  if (graphs === undefined) {
    graphs = new Map();
    clientStyles.set(server, graphs);
  }
  graphs.set(owner, new Set(styles));
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
): Promise<readonly string[]> {
  const graphs = clientStyles.get(server);
  if (graphs === undefined) return [];
  const urls = new Set<string>();
  for (const styles of graphs.values()) {
    for (const style of styles) {
      const url = styleUrl(server.config.root, style);
      if (url !== null) urls.add(url);
    }
  }
  return [...urls].sort();
}
