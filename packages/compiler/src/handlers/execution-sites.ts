import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  type Ctx,
  type RowCtx,
} from '../context';
import {
  appendScopeCommit,
  buildScopeCommit,
  createScopeWrites,
  type ScopeWrites,
} from '../handler-commits';
import { buildEventOriginCommit } from '../handler-origin';
import { generatedIdentifier, md } from '../identifiers';
import { HandlerPath } from './traversal';

export interface HandlerExecutionSite {
  path: HandlerPath;
  writes: ScopeWrites;
  flag?: t.Identifier;
  temporaries?: t.Identifier[];
}

export function finalizeHandlerInstrumentation(
  ctx: Ctx,
  rootFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  clonedFn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  root: t.Node,
  scopes: Map<t.Node, ScopeWrites>,
  executionSites: ReadonlyMap<t.Node, HandlerExecutionSite>,
  compName: string | null,
  rowCtx: RowCtx | undefined,
  eventBoundary: boolean,
  eventOriginId: t.Expression | undefined,
  executionAwareRoot: boolean,
): void {
  ctx.handlerHasRootCommit.set(rootFn, scopes.has(root));

  if (eventBoundary && !scopes.has(root)) {
    const eventScope = createScopeWrites();
    eventScope.eventOrigin = buildEventOriginCommit(
      ctx,
      compName,
      rowCtx,
      eventOriginId,
    );
    scopes.set(root, eventScope);
  }

  const guardedRootSites: Array<HandlerExecutionSite & { commit: t.Statement }> = [];
  if (executionAwareRoot) {
    for (const site of executionSites.values()) {
      const commit = buildScopeCommit(ctx, site.writes, compName, rowCtx);
      if (commit !== null) guardedRootSites.push({ ...site, commit });
    }
  }
  for (const site of guardedRootSites) {
    site.flag = generatedIdentifier(ctx, 'didWrite');
  }
  guardedRootSites
    .sort((left, right) => pathDepth(right.path) - pathDepth(left.path))
    .forEach((site) => {
      site.temporaries = markExecutionSite(ctx, site.path, site.flag!);
    });

  for (const [fn, writes] of scopes) {
    const commit =
      executionAwareRoot && fn === root
        ? guardedRootSites.length === 0
          ? null
          : astFactory.blockStatement(
              guardedRootSites.map((site) =>
                astFactory.ifStatement(
                  cloneEstreeNode(site.flag!),
                  cloneEstreeNode(site.commit),
                ),
              ),
            )
        : buildScopeCommit(ctx, writes, compName, rowCtx);
    if (commit === null) continue;
    appendScopeCommit(
      ctx,
      fn as t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
      commit,
    );
  }

  if (guardedRootSites.length > 0) {
    if (!astFactory.isBlockStatement(clonedFn.body)) {
      throw new Error(
        'memo-dom: execution-aware callback commit did not produce a block body',
      );
    }
    clonedFn.body.body.unshift(
      astFactory.variableDeclaration(
        'let',
        guardedRootSites.flatMap((site) => [
          astFactory.variableDeclarator(cloneEstreeNode(site.flag!), astFactory.booleanLiteral(false)),
          ...(site.temporaries ?? []).map((temporary) =>
            astFactory.variableDeclarator(cloneEstreeNode(temporary)),
          ),
        ]),
      ),
    );
  }
  rootFn.body = clonedFn.body;
}

function pathDepth(path: HandlerPath): number {
  let depth = 0;
  let current: HandlerPath | null = path;
  while (current.parentPath !== null) {
    depth++;
    current = current.parentPath;
  }
  return depth;
}

function markExecutionSite(
  ctx: Ctx,
  path: HandlerPath,
  flag: t.Identifier,
): t.Identifier[] {
  if (
    path.isAssignmentExpression({ operator: '=' }) &&
    (astFactory.isIdentifier(path.node.left) ||
      astFactory.isMemberExpression(path.node.left) &&
      !astFactory.isSuper(path.node.left.object) &&
      !astFactory.isPrivateName(path.node.left.property))
  ) {
    const original = path.node;
    const previous = generatedIdentifier(ctx, 'previousValue');
    const result = generatedIdentifier(ctx, 'assignedValue');
    const temporaries = [previous, result];
    let before: t.Expression;
    let assignment: t.AssignmentExpression;
    let after: t.Expression;

    if (astFactory.isIdentifier(original.left)) {
      before = astFactory.identifier(original.left.name);
      assignment = cloneEstreeNode(original, true);
      after = astFactory.identifier(original.left.name);
    } else if (astFactory.isMemberExpression(original.left)) {
      const receiver = generatedIdentifier(ctx, 'assignmentReceiver');
      const property = generatedIdentifier(ctx, 'assignmentProperty');
      temporaries.push(receiver, property);
      const access = (): t.MemberExpression =>
        astFactory.memberExpression(
          cloneEstreeNode(receiver),
          cloneEstreeNode(property),
          true,
        );
      const propertyExpression = original.left.computed
        ? cloneEstreeNode(original.left.property as t.Expression, true)
        : astFactory.stringLiteral((original.left.property as t.Identifier).name);
      before = astFactory.sequenceExpression([
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(receiver),
          cloneEstreeNode(original.left.object as t.Expression, true),
        ),
        astFactory.assignmentExpression('=', cloneEstreeNode(property), propertyExpression),
        access(),
      ]);
      assignment = astFactory.assignmentExpression('=', access(), cloneEstreeNode(original.right, true));
      after = access();
    } else {
      return [];
    }

    path.replaceWith(
      astFactory.sequenceExpression([
        astFactory.assignmentExpression('=', cloneEstreeNode(previous), before),
        astFactory.assignmentExpression('=', cloneEstreeNode(result), assignment),
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(flag),
          astFactory.logicalExpression(
            '||',
            cloneEstreeNode(flag),
            astFactory.callExpression(md(ctx, 'effectAssignmentChanged'), [
              cloneEstreeNode(previous),
              after,
            ]),
          ),
        ),
        cloneEstreeNode(result),
      ]),
    );
    return temporaries;
  }

  const mark = astFactory.assignmentExpression(
    '=',
    cloneEstreeNode(flag),
    astFactory.booleanLiteral(true),
  );
  if (path.isVariableDeclarator()) {
    const init = path.node.init;
    if (init === null || !astFactory.isExpression(init)) {
      throw new Error(
        'memo-dom: execution-aware variable site has no expression initializer',
      );
    }
    path.node.init = astFactory.sequenceExpression([mark, init]);
    return [];
  }
  if (!path.isExpression()) {
    throw new Error(
      `memo-dom: unsupported execution-aware write site '${path.node.type}'`,
    );
  }
  path.replaceWith(
    astFactory.sequenceExpression([
      mark,
      cloneEstreeNode(path.node, true),
    ]),
  );
  return [];
}
