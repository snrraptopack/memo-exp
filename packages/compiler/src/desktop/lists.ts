/** Desktop list emission consumes the core source, callback, and key plan. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import type { MapSite } from '../lists';
import type { desktopComponentCall } from './component-call';
import { extractPatternIdentifiers, type BaseNode } from '../ast';
import { walkAst } from '../ast/walk';
import { matchMapCall } from '../lists';
import type { Ctx } from '../context';

/** Desktop reconciles evaluated arrays; computed sources need no DOM access-table identity. */
export function prepareDesktopListSources(root: t.Node, ctx: Ctx): void {
  let occurrence = 0;
  walkAst<t.Node>(root, { enter(node) {
    const call = matchMapCall(node);
    if (!call) return;
    const source = (call.callee as t.MemberExpression | t.OptionalMemberExpression).object;
    if (b.isCallExpression(source) || b.isOptionalCallExpression(source)) {
      const key = `$desktopExpression${occurrence++}`;
      ctx.analyzedListSources.set(call, { key, local: true, suffixBase: key });
    }
  } });
}

export function desktopListPlan(site: MapSite, options: {
  call(element: t.JSXElement): ReturnType<typeof desktopComponentCall>;
  fresh(name: string): t.Identifier;
  fail(message: string, at?: t.Node): never;
  sourcesFor(expression: t.Expression): readonly string[] | null;
}) {
  if (site.form !== 'component' || !site.jsx) options.fail('desktop list rows currently require a named component; inline rows and delegated callbacks are not implemented', site.jsx ?? undefined);
  if (!site.keyExpr || site.keyFromSpread) options.fail('desktop list rows require an explicit key={...} with a string or finite number', site.jsx);
  if (site.prelude.length) options.fail('desktop list callback preludes must be pure const derivations; expression statements are not implemented', site.prelude[0]);
  const element: t.JSXElement = { ...site.jsx, openingElement: { ...site.jsx.openingElement,
    attributes: site.jsx.openingElement.attributes.filter(attribute => !(b.isJSXAttribute(attribute) && b.isJSXIdentifier(attribute.name, { name: 'key' }))) } };
  const call = options.call(element);
  const index = site.indexParam ? b.identifier(site.indexParam) : options.fresh('__desktopRowIndex');
  const row = b.objectExpression([
    b.objectProperty(b.identifier('key'), site.keyExpr),
    b.objectProperty(b.identifier('props'), call.props),
  ]);
  const callback = b.arrowFunctionExpression([site.itemPattern, index], site.prelude.length
    ? b.blockStatement([...site.prelude, b.returnStatement(row)]) : row);
  let source: t.Expression = site.sourceExpr;
  if (site.optional) source = b.logicalExpression('??', source, b.arrayExpression([]));
  const local = new Set([...extractPatternIdentifiers(site.itemPattern as unknown as BaseNode).map(binding => binding.name), index.name]);
  const sourceReads = options.sourcesFor(site.sourceExpr);
  const rowReads = options.sourcesFor(b.arrowFunctionExpression([site.itemPattern, index], row));
  const sources = sourceReads === null || rowReads === null ? null : [...new Set([...sourceReads, ...rowReads.filter(name => !local.has(name))])].sort();
  return { component: call.component, sources, read: b.arrowFunctionExpression([], b.callExpression(b.memberExpression(source, b.identifier('map')), [callback])) };
}
