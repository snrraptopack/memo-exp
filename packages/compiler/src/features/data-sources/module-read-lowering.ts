/** Module-source read lowering for transparent data. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  cloneNode as cloneEstreeNode,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import { astBindingAt, type Ctx } from '../../context';
import { generatedIdentifier, mdd } from '../../identifiers';
import {
  isActionRefreshTarget,
  isBoundTo,
  isEventOrRefContainer,
  isGeneratedDataCall,
  isPassthroughArgument,
} from './read-analysis';
import {
  annotateTransparentSources,
  transparentExpressionSources,
} from './subscriptions';

/**
 * Lower reads of module-scope source refs inside a component:
 *   - list receivers (.map)  → _MDD.readModuleSourceList(_ref)
 *   - other render sites     → _MDD.readResolvedValueForRender(_ref)
 *   - imperative statements  → _MDD.readResolvedValue(_ref, name, site)
 * Each emitted read materializes the source into the ACTIVE runtime on first
 * touch (request-local on the server).
 */
interface EstreeModuleSourceEntry {
  name: string;
  key: string;
  binding: AstBinding;
}

export function lowerModuleRefReadsEstree(
  ctx: Ctx,
  componentName: string,
  component: BaseNode,
  refresh: () => void,
): void {
  const entries: EstreeModuleSourceEntry[] = [];
  for (const [name, key] of ctx.transparentModuleSources) {
    const binding = astBindingAt(ctx, component, name);
    if (binding !== undefined) entries.push({ name, key, binding });
  }
  if (entries.length === 0) return;
  ctx.usesTransparentData = true;

  const entryFor = (identifier: BaseNode): EstreeModuleSourceEntry | null => {
    if (identifier.type !== 'Identifier') return null;
    const name = (identifier as unknown as AstIdentifier).name;
    const entry = entries.find((candidate) => candidate.name === name);
    return entry !== undefined && isBoundTo(ctx, identifier, entry.binding)
      ? entry
      : null;
  };
  const refCall = (key: string): t.Expression =>
    astFactory.callExpression(mdd(ctx, 'sourceRef'), [astFactory.stringLiteral(key)]);
  const isListReceiver = (identifier: BaseNode): boolean => {
    const member = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    if (member?.type !== 'MemberExpression') return false;
    const memberNode = member as unknown as t.MemberExpression;
    if (
      memberNode.object !== identifier ||
      memberNode.computed ||
      !astFactory.isIdentifier(memberNode.property, { name: 'map' })
    ) return false;
    return ctx.astAnalysis?.parentByNode.get(member)?.type === 'CallExpression';
  };
  const collect = (root: BaseNode): Array<{
    identifier: BaseNode;
    entry: EstreeModuleSourceEntry;
  }> => {
    const found: Array<{
      identifier: BaseNode;
      entry: EstreeModuleSourceEntry;
    }> = [];
    walkAst(root, {
      enter(node) {
        if (node.type !== 'Identifier') return;
        const entry = entryFor(node);
        if (entry === null || isPassthroughArgument(ctx, node)) return;
        found.push({ identifier: node, entry });
      },
    });
    return found;
  };
  const replaceRead = (
    identifier: BaseNode,
    entry: EstreeModuleSourceEntry,
    helper: 'readModuleSourceList' | 'readResolvedValueForRender',
  ): void => {
    overwriteNode(
      identifier,
      astFactory.callExpression(
        mdd(ctx, helper),
        [refCall(entry.key)],
      ) as unknown as BaseNode,
    );
  };

  walkAst(component, {
    enter(node) {
      if (node.type !== 'JSXExpressionContainer') return;
      if (isEventOrRefContainer(ctx, node)) return false;
      const rawExpression = childNode(node, 'expression');
      if (
        rawExpression === null ||
        !astFactory.isExpression(rawExpression as unknown as t.Node)
      ) return false;
      const expression = rawExpression as unknown as t.Expression;
      const groupMarked = (
        expression as t.Expression & { __memoDomTransparentGroup?: boolean }
      ).__memoDomTransparentGroup === true;

      if (groupMarked) {
        const committedContainers: BaseNode[] = [];
        walkAst(rawExpression, {
          enter(current) {
            let ancestor = ctx.astAnalysis?.parentByNode.get(current) ?? null;
            let insideFragment = false;
            while (ancestor !== null && ancestor !== rawExpression) {
              if (ancestor.type === 'JSXFragment') {
                insideFragment = true;
                break;
              }
              ancestor = ctx.astAnalysis?.parentByNode.get(ancestor) ?? null;
            }
            if (
              current !== node &&
              current.type === 'JSXExpressionContainer' &&
              insideFragment &&
              !isEventOrRefContainer(ctx, current)
            ) committedContainers.push(current);
          },
        });
        for (const container of committedContainers) {
          const inner = childNode(container, 'expression');
          if (inner === null) continue;
          for (const { identifier, entry } of collect(inner)) {
            replaceRead(
              identifier,
              entry,
              isListReceiver(identifier)
                ? 'readModuleSourceList'
                : 'readResolvedValueForRender',
            );
          }
        }
        refresh();
        return false;
      }

      const referenced = collect(rawExpression);
      if (referenced.length === 0) return undefined;
      for (const { identifier, entry } of referenced) {
        if (isListReceiver(identifier)) {
          replaceRead(identifier, entry, 'readModuleSourceList');
        }
      }
      refresh();
      const remaining = collect(rawExpression);
      if (remaining.length > 0) {
        const direct = entryFor(rawExpression);
        if (direct !== null) {
          replaceRead(rawExpression, direct, 'readResolvedValueForRender');
        } else {
          const uniqueEntries = [
            ...new Map(
              remaining.map(({ entry }) => [entry.name, entry]),
            ).values(),
          ];
          const replacements = new Map<string, t.Identifier>();
          const parameters = uniqueEntries.map((entry) => {
            const parameter = generatedIdentifier(ctx, `${entry.name}Value`);
            replacements.set(entry.name, parameter);
            return cloneEstreeNode(parameter);
          });
          for (const { identifier, entry } of remaining) {
            overwriteNode(
              identifier,
              cloneEstreeNode(replacements.get(entry.name)!) as unknown as BaseNode,
            );
          }
          const body = cloneEstreeNode(expression, true);
          const callback = astFactory.arrowFunctionExpression(parameters, body);
          ctx.compilerOwnedCallbacks.add(callback);
          overwriteNode(
            rawExpression,
            astFactory.callExpression(mdd(ctx, 'readResolvedValuesForRender'), [
              astFactory.arrayExpression(uniqueEntries.map((entry) => refCall(entry.key))),
              callback,
            ]) as unknown as BaseNode,
          );
        }
      }
      annotateTransparentSources(
        rawExpression as unknown as t.Expression,
        transparentExpressionSources(
          ctx,
          rawExpression as unknown as t.Expression,
        ),
      );
      refresh();
      return false;
    },
  });

  const derivationDeclarations = new Set(
    (ctx.instanceDerivations.get(componentName) ?? [])
      .map((derivation) => derivation.declaration as unknown as BaseNode),
  );
  const insideDerivationInit = (identifier: BaseNode): boolean => {
    let current = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    while (current !== null && !current.type.endsWith('Statement')) {
      if (current.type === 'VariableDeclarator') {
        const declaration = ctx.astAnalysis?.parentByNode.get(current) ?? null;
        return declaration !== null && derivationDeclarations.has(declaration);
      }
      current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
    }
    return false;
  };
  const imperative = collect(component).filter(({ identifier }) =>
    !insideDerivationInit(identifier) &&
    !isActionRefreshTarget(ctx, identifier) &&
    !isGeneratedDataCall(ctx, identifier)
  );
  for (const { identifier, entry } of imperative) {
    const site = identifier.loc === null || identifier.loc === undefined
      ? ctx.moduleId
      : `${ctx.moduleId}:${identifier.loc.start.line}:${identifier.loc.start.column + 1}`;
    overwriteNode(
      identifier,
      astFactory.callExpression(mdd(ctx, 'readResolvedValue'), [
        refCall(entry.key),
        astFactory.stringLiteral(entry.name),
        astFactory.stringLiteral(site),
      ]) as unknown as BaseNode,
    );
  }
  refresh();
}
