/** Opaque built CSS metadata. Blitz owns parsing, cascade, layout and painting. */
import type { Template } from '../host/protocol';

const stylesheets = new Map<string, { css: string; revision: string }>();

export interface StylesheetSource {
  readonly source: string;
  readonly css: string;
  readonly revision: string;
}

export function registerStylesheet(source: string, css: string, revision: string): void {
  stylesheets.set(source, { css, revision });
}

/** A complete Vite output replaces prior CSS; deleted imports cannot linger. */
export function replaceStylesheets(next: readonly StylesheetSource[]): void {
  stylesheets.clear();
  for (const stylesheet of next) {
    registerStylesheet(stylesheet.source, stylesheet.css, stylesheet.revision);
  }
}

export function withStylesheets(template: Template): Template {
  if (stylesheets.size === 0) {
    return template;
  }
  const nodes = [...template.nodes];
  const revisions: string[] = [];
  for (const { css, revision } of stylesheets.values()) {
    const parent = nodes.length;
    // Append auxiliary style sources so authored source indices stay stable.
    // They join the root's native range and retire with that accepted owner.
    nodes.push({
      parent: null,
      node: {
        kind: 'element',
        name: { namespace: 'http://www.w3.org/1999/xhtml', local: 'style' },
        attributes: []
      }
    });
    nodes.push({ parent, node: { kind: 'text', value: css } });
    revisions.push(revision);
  }
  return { key: template.key + ':css:' + revisions.join('-'), nodes };
}
