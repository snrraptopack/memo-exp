import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import { containsJsx, type MapSite } from '../lists';

/** Host-only rows without lifecycle/child ownership can live in their list. */
export function isSimpleInlineRow(site: MapSite): boolean {
  if (site.form !== 'inline' || site.jsx === null || site.prelude.length !== 0 ||
      !astFactory.isIdentifier(site.sourceExpr) || !astFactory.isIdentifier(site.itemPattern)) return false;
  let eligible = true;
  walkAst<BaseNode>(site.jsx, { enter(node) {
    if (!eligible) return false;
    if (astFactory.isJSXAttribute(node)) {
      const name = node.name;
      if (!astFactory.isJSXIdentifier(name)) { eligible = false; return false; }
      if (name.name === 'ref') { eligible = false; return false; }
      // Events use the entry's update closure; they are not render expressions.
      if (/^on[A-Z]/.test(name.name)) return false;
    }
    if (astFactory.isJSXElement(node)) {
      const name = node.openingElement.name;
      if (!astFactory.isJSXIdentifier(name) || !/^[a-z]/.test(name.name)) eligible = false;
    }
    if (node.type === 'JSXSpreadAttribute' || node.type === 'JSXFragment' ||
        node.type === 'CallExpression' || node.type === 'OptionalCallExpression' ||
        node.type === 'NewExpression' || node.type === 'TaggedTemplateExpression' ||
        node.type === 'AwaitExpression' || node.type === 'YieldExpression' ||
        node.type === 'AssignmentExpression' || node.type === 'UpdateExpression' ||
        node.type === 'UnaryExpression' && astFactory.isUnaryExpression(node, { operator: 'delete' }) ||
        (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') && containsJsx(node)) eligible = false;
    return;
  } });
  return eligible;
}
