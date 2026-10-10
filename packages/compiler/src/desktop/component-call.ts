/** Authored props shared by fixed and conditional desktop component sites. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { unwrapTypeExpression } from '../ast/normalize';
import type { ComponentPropsPlan } from '../components/props';
import type { LinkedComponentImport } from '../context/model';
import { nodeHasJsx } from '../context/ast';

export function desktopComponentCall(element: t.JSXElement, options: {
  components: ReadonlyMap<string, ComponentPropsPlan>;
  imports: ReadonlyMap<string, LinkedComponentImport>;
  sourcesFor: (expression: t.Expression) => readonly string[] | null;
  fail: (message: string, at: t.Node) => never;
}) {
  const fail: (message: string, at: t.Node) => never = options.fail;
  const opening = element.openingElement;
  if (!b.isJSXIdentifier(opening.name)) fail('dynamic tags are not implemented yet', opening);
  const tag = opening.name.name;
  const plan = options.components.get(tag);
  const imported = options.imports.get(tag);
  if (!/^[A-Z]/.test(tag) || (!plan && !imported)) fail(`unresolved desktop component <${tag}>`, opening);
  if (element.children.some(child => !(b.isJSXText(child) && !child.value.trim()) && !(b.isJSXExpressionContainer(child) && b.isJSXEmptyExpression(child.expression)))) fail('component children require render-prop regions, which are not implemented yet', element);
  const props: t.ObjectProperty[] = [];
  const seen = new Set<string>();
  let dependencies: Set<string> | null = new Set();
  for (const attribute of opening.attributes) {
    if (!b.isJSXAttribute(attribute) || !b.isJSXIdentifier(attribute.name)) fail('component props require named attributes', attribute);
    const name = attribute.name.name;
    if (seen.has(name)) fail(`duplicate ${name} prop`, attribute);
    seen.add(name);
    const names = plan?.names ?? imported?.props;
    const acceptsUnknown = plan?.acceptsUnknown ?? imported?.acceptsUnknownProps;
    if (names && !acceptsUnknown && !names.includes(name)) fail(`component <${tag}> does not declare prop ${name}`, attribute);
    let value: t.Expression = b.booleanLiteral(true);
    if (attribute.value) {
      value = (b.isJSXExpressionContainer(attribute.value) ? unwrapTypeExpression(attribute.value.expression) : attribute.value) as t.Expression;
      walkAst<t.Node>(value, { enter(current) {
        if (b.isArrowFunctionExpression(current) || b.isFunctionExpression(current)) {
          if (current.async || current.generator) fail('desktop callback props must be synchronous', current);
          if (nodeHasJsx(current)) fail('desktop render-prop callbacks are not implemented yet', current);
          return false;
        }
        if (b.isJSXElement(current) || b.isJSXFragment(current) || b.isJSXEmptyExpression(current) || ['ObjectExpression', 'ArrayExpression'].includes(current.type)) fail('desktop child props currently require primitive expressions or synchronous callbacks', current);
      } });
    }
    const reads = options.sourcesFor(value);
    if (reads === null) dependencies = null;
    else if (dependencies) for (const source of reads) dependencies.add(source);
    props.push(b.objectProperty(b.stringLiteral(name), value, true));
  }
  return { component: b.identifier(tag), props: b.objectExpression(props), sources: dependencies === null ? null : [...dependencies].sort() };
}
