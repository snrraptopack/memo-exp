import {
  annotateWithHash,
  prepareStylesheetForRender,
  renderStylesheets,
} from '@tsrx/core';
import { cloneNode } from '../builders';
import { isNode, nodeFields as fields } from '../access';
import { ESTREE_VISITOR_KEYS } from '../walk';
import type { BaseNode } from '../types';
import { TsrxLoweringError } from './lower';

function isFunction(node: BaseNode): boolean {
  return node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression';
}

interface OwnedStylesheet {
  owner: BaseNode;
  stylesheet: BaseNode;
}

function collectOwnedStylesheets(program: BaseNode): OwnedStylesheet[] {
  const stylesheets: OwnedStylesheet[] = [];

  const visit = (node: BaseNode, owner: BaseNode | null): void => {
    const currentOwner = isFunction(node) ? node : owner;
    if (node.type === 'JSXStyleElement') {
      if (currentOwner === null) {
        throw new TsrxLoweringError(
          'scoped <style> blocks must belong to a function template',
          node,
        );
      }
      const children = fields(node).children;
      const stylesheet = Array.isArray(children)
        ? children.find((child) => isNode(child) && child.type === 'StyleSheet')
        : undefined;
      if (!isNode(stylesheet)) {
        throw new TsrxLoweringError('scoped <style> block has no stylesheet', node);
      }
      stylesheets.push({ owner: currentOwner, stylesheet });
      return;
    }

    const keys = ESTREE_VISITOR_KEYS[node.type] ?? Object.keys(node);
    for (const key of keys) {
      if (key === 'loc' || key === 'metadata' || key === 'css') continue;
      const value = fields(node)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) visit(child, currentOwner);
        }
      } else if (isNode(value)) {
        visit(value, currentOwner);
      }
    }
  };

  visit(program, null);
  return stylesheets;
}

export interface PreparedTsrxStyles {
  program: BaseNode;
  css: string;
}

/** Extract scoped CSS and annotate owned native JSX with TSRX's stable hash. */
export function prepareTsrxStyles(program: BaseNode): PreparedTsrxStyles {
  const prepared = cloneNode(program);
  const owned = collectOwnedStylesheets(prepared);
  for (const { owner, stylesheet } of owned) {
    prepareStylesheetForRender(stylesheet);
    const body = fields(owner).body;
    if (!isNode(body)) {
      throw new TsrxLoweringError('style owner has no render body', owner);
    }
    annotateWithHash(body, String(fields(stylesheet).hash), 'class', false);
  }
  return {
    program: prepared,
    css: renderStylesheets(owned.map(({ stylesheet }) => stylesheet)),
  };
}
