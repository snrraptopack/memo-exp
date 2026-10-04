/**
 * Source-preserving HTML shell adapter. Accept only an unambiguous, empty div
 * directly in body and its exact mount entry. Unknown shell syntax is left to
 * Vite's ordinary client pipeline. No unrelated script is removed.
 */
import { dirname, relative, resolve } from 'node:path';
import { normalizeFile } from './paths';

interface Tag {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly start: number;
  readonly end: number;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const rawTags = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes']);

/** Tokenize shell markup without serializing or changing the rest of the file. */
function tags(html: string): Tag[] | null {
  const result: Tag[] = [];
  let offset = 0;
  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end === -1) return null;
      offset = end + 3;
      continue;
    }
    if (/^<!doctype\s/i.test(html.slice(start))) {
      const end = html.indexOf('>', start);
      if (end === -1) return null;
      offset = end + 1;
      continue;
    }
    const opening = /^<(\/)?([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(start));
    if (!opening) return null;
    const name = opening[2]!.toLowerCase();
    const closing = opening[1] !== undefined;
    const attributes = new Map<string, string>();
    offset = start + opening[0].length;
    let selfClosing = false;
    while (offset < html.length) {
      const whitespace = /^\s*/.exec(html.slice(offset))![0];
      offset += whitespace.length;
      if (html.startsWith('/>', offset)) { selfClosing = true; offset += 2; break; }
      if (html[offset] === '>') { offset++; break; }
      if (closing || !whitespace) return null;
      const attribute = /^([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.exec(html.slice(offset));
      if (!attribute) return null;
      const key = attribute[1]!.toLowerCase();
      if (attributes.has(key)) return null;
      attributes.set(key, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      offset += attribute[0].length;
    }
    if (html[offset - 1] !== '>') return null;
    result.push({ name, attributes, start, end: offset, closing, selfClosing });
    if (!closing && rawTags.has(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = offset;
      const match = end.exec(html);
      if (!match) return null;
      result.push({ name, attributes: new Map(), start: match.index,
        end: end.lastIndex, closing: true, selfClosing: false });
      offset = end.lastIndex;
    }
  }
  return result;
}

export interface InitialPage {
  readonly entry: string;
  readonly target: string;
  readonly html: string;
  readonly interactive?: true;
}

/** null means the shell needs the existing browser entry. */
export function applyInitialPage(
  shell: string, filename: string, root: string, page: InitialPage,
  styles: ReadonlySet<string>, ssr = false,
): string | null {
  const tokens = tags(shell);
  if (!tokens) return null;
  const outlet = '<!--ssr-outlet-->';
  if (ssr && (shell.split(outlet).length !== 2 ||
      tokens.some(tag => tag.name === 'link' && tag.attributes.get('rel')?.toLowerCase() === 'modulepreload'))) return null;
  const stack: Tag[] = [];
  const hosts: { opening: Tag; closing: Tag }[] = [];
  const scripts: { opening: Tag; closing: Tag }[] = [];
  let targetCount = 0;
  let bodyCount = 0;
  // Another executable entry may write exported state read by this root.
  // Whole-page interaction analysis has not proved that relationship yet.
  if (tokens.filter(tag => tag.name === 'script' && !tag.closing).length !== 1) return null;
  if (tokens.some(tag => tag.name === 'base' || tag.name === 'template' || tag.name === 'noscript')) return null;
  for (const token of tokens) {
    if (token.closing) {
      const opening = stack.pop();
      if (!opening || opening.name !== token.name) return null;
      if (opening.attributes.get('id') === page.target && opening.name === 'div' && stack.at(-1)?.name === 'body') {
        hosts.push({ opening, closing: token });
      }
      if (opening.name === 'script' && opening.attributes.get('type') === 'module') {
        const src = opening.attributes.get('src');
        if (src && !/[?#&]/.test(src) && !/^[a-z]+:/i.test(src) && !src.startsWith('//')) {
          const file = normalizeFile(src.startsWith('/') ? resolve(root, `.${src}`) : resolve(dirname(filename), src));
          if (file === page.entry) scripts.push({ opening, closing: token });
        }
      }
    } else {
      if (token.name === 'html' && stack.length) return null;
      if (token.name === 'body') {
        bodyCount++;
        if (stack.length > 1 || stack.length === 1 && stack[0]?.name !== 'html') return null;
      }
      if (token.attributes.get('id') === page.target) targetCount++;
      // HTML ignores '/>' on non-void elements; don't assume XML semantics.
      if (token.selfClosing && !voidTags.has(token.name)) return null;
      if (!voidTags.has(token.name)) stack.push(token);
    }
  }
  if (stack.length || bodyCount !== 1 || targetCount !== 1 || hosts.length !== 1 || scripts.length !== 1) return null;
  const host = hosts[0]!;
  const script = scripts[0]!;
  if (shell.slice(host.opening.end, host.closing.start).trim() !== (ssr ? outlet : '') ||
      shell.slice(script.opening.end, script.closing.start).trim()) return null;
  // Preserve authored/imported styles as HTML dependencies so Vite still
  // processes CSS, preprocessor imports, URLs and extracted component styles.
  const hrefs = [...styles].map(style => relative(root, style).replaceAll('\\', '/'));
  if (hrefs.some(href => href.startsWith('../') || href.includes('\0') || /^[a-z]+:/i.test(href))) return null;
  const links = hrefs.map(href => {
    return `<link rel="stylesheet" href="/${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  }).join('\n');
  const edits = [
    { start: host.opening.end, end: host.closing.start, text: ssr ? outlet : page.html },
    { start: script.opening.start, end: script.closing.end, text: links + (page.interactive
      ? shell.slice(script.opening.start, script.closing.end) : '') },
  ].sort((left, right) => right.start - left.start);
  let html = shell;
  for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}
