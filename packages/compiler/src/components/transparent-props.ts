/** Normalize colorless sources transported through component prop objects. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode,
  isValidIdentifier,
  overwriteNode,
  walkAst,
  type BaseNode,
} from '../ast';
import { astBindingAt, type Ctx } from '../context';
import { generatedIdentifier } from '../identifiers';
import { localBindingForProp, objectBindingName } from './props';

/**
 * Return local source binding -> authored prop name for one component.
 *
 * Destructured parameters already provide a local binding. Generic object
 * parameters (`props.items`) receive a compiler-owned alias so the ordinary
 * transparent-source lowering can treat both authoring styles identically.
 */
export function materializeTransparentPropBindings(
  ctx: Ctx,
  component: string,
): Map<string, string> {
  const sourceProps = new Map<string, string>();
  const plan = ctx.componentProps.get(component);
  const componentPath = ctx.compPaths.get(component);
  if (plan === undefined || componentPath === undefined) return sourceProps;

  const componentNode = componentPath.node as unknown as BaseNode;
  const objectBinding = objectBindingName(plan);
  const objectBindingIdentity = objectBinding === null
    ? undefined
    : astBindingAt(ctx, componentNode, objectBinding);

  for (const [prop, origin] of ctx.linkedComponentPropSources.get(component) ?? []) {
    if (origin.transparent !== true) continue;
    let binding = localBindingForProp(plan, prop);
    if (
      binding === null &&
      objectBinding !== null &&
      objectBindingIdentity !== undefined
    ) {
      const alias = generatedIdentifier(ctx, `${prop}Source`);
      const reads: BaseNode[] = [];
      walkAst(componentNode, {
        enter(node) {
          if (
            node.type !== 'MemberExpression' &&
            node.type !== 'OptionalMemberExpression'
          ) return;
          const member = node as unknown as
            | t.MemberExpression
            | t.OptionalMemberExpression;
          if (!astFactory.isIdentifier(member.object, { name: objectBinding })) {
            return;
          }
          const resolved = astBindingAt(
            ctx,
            member.object as unknown as BaseNode,
            objectBinding,
          );
          if (resolved?.identifier !== objectBindingIdentity.identifier) return;
          const key = member.computed
            ? astFactory.isStringLiteral(member.property)
              ? member.property.value
              : null
            : astFactory.isIdentifier(member.property)
              ? member.property.name
              : null;
          if (key === prop) reads.push(node);
        },
      });
      if (reads.length > 0) {
        for (const read of reads) {
          overwriteNode(read, cloneNode(alias) as unknown as BaseNode);
        }
        componentPath.node.body.body.unshift(
          astFactory.variableDeclaration('const', [
            astFactory.variableDeclarator(
              cloneNode(alias),
              astFactory.memberExpression(
                astFactory.identifier(objectBinding),
                isValidIdentifier(prop)
                  ? astFactory.identifier(prop)
                  : astFactory.stringLiteral(prop),
                !isValidIdentifier(prop),
              ),
            ),
          ]),
        );
        binding = alias.name;
      }
    }
    if (binding !== null) sourceProps.set(binding, prop);
  }
  return sourceProps;
}
