/** Adapt the framework's existing CSS AST. Native styles use GPUI/Taffy. */
import { parseStyle } from '@tsrx/core';

export interface DesktopDeclaration { property: string; value: string }
export interface DesktopSelector {
  combinator: string | null;
  selectors: { type: 'tag' | 'class' | 'id' | 'state' | 'scope'; name: string }[];
}
export interface DesktopCssRule { selectors: DesktopSelector[][]; declarations: DesktopDeclaration[] }
interface CssNode {
  type: string; name: string; property: string; value: string; args?: unknown;
  children: CssNode[]; selectors: CssNode[]; combinator: CssNode | null;
  prelude: CssNode; block: CssNode;
}

export function desktopCssRules(css: string, filename: string): DesktopCssRule[] {
  const sheet = parseStyle(css, { filename, line: 1, column: 1 }, {}) as CssNode;
  return sheet.children.map(rule => {
    if (rule.type !== 'Rule') throw new Error(`desktop CSS: ${rule.type} rules are not implemented`);
    return {
      selectors: rule.prelude.children.map(selector => selector.children.map((relative, index, chain): DesktopSelector => {
        const combinator = relative.combinator?.name ?? null;
        if (combinator && ![' ', '>', '+', '~'].includes(combinator)) throw new Error(`desktop CSS: combinator ${combinator} is not implemented`);
        return { combinator, selectors: relative.selectors.map(part => {
          if (part.type === 'TypeSelector') return { type: 'tag', name: part.name };
          if (part.type === 'ClassSelector') return { type: 'class', name: part.name };
          if (part.type === 'IdSelector') return { type: 'id', name: part.name };
          if (part.type === 'PseudoClassSelector' && part.name === 'where' && part.args) {
            const list = part.args as CssNode;
            const scope = list.children?.[0]?.children?.[0]?.selectors?.[0];
            if (list.children?.length === 1 && list.children[0]!.children?.length === 1 && list.children[0]!.children[0]!.selectors?.length === 1 && scope?.type === 'ClassSelector') return { type: 'scope', name: scope.name };
          }
          if (part.type === 'PseudoClassSelector' && part.args === null && ['hover', 'focus'].includes(part.name) && index === chain.length - 1) return { type: 'state', name: part.name };
          throw new Error(`desktop CSS: selector ${part.type} ${part.name} is not implemented`);
        }) };
      })),
      declarations: rule.block.children.map(declaration => {
        if (declaration.type !== 'Declaration') throw new Error('desktop CSS: nested rules are not implemented');
        return { property: declaration.property.toLowerCase(), value: declaration.value };
      }),
    };
  });
}

export function desktopInlineDeclarations(css: string): DesktopDeclaration[] {
  return desktopCssRules(`* { ${css} }`, 'inline.css')[0]?.declarations ?? [];
}
