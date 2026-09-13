/** Component source discovery, event slots, and render-time validation. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  walkAst,
  type BaseNode,
  type Identifier,
} from '../../ast';
import { astBindingAt, type Ctx } from '../../context';
import { generatedIdentifier } from '../../identifiers';
import { materializeTransparentPropBindings } from '../../components/transparent-props';
import { isCallToImported } from './discovery';

const RENDER_FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** Reject mutating server functions invoked during module/component render. */
export function rejectNonGetServerFunctionRenderCalls(
  ctx: Ctx,
  programPath: {
    node: t.Program;
    buildCodeFrameError(message: string, at?: t.Node): Error;
  },
): void {
  if (ctx.transparentSourceFactoryMethods.size === 0) return;
  const componentNodes = new Set(
    [...ctx.compPaths.values()].map(path => path.node as unknown as BaseNode),
  );
  const functionStack: BaseNode[] = [];

  walkAst(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (RENDER_FUNCTION_TYPES.has(node.type)) {
        functionStack.push(node);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const call = node as unknown as t.CallExpression;
      if (!astFactory.isIdentifier(call.callee)) return;
      const method = ctx.transparentSourceFactoryMethods.get(call.callee.name);
      if (method === undefined || method === 'GET') return;
      if (!isCallToImported(
        ctx,
        node,
        call,
        ctx.transparentSourceFactories,
      )) return;

      const owner = functionStack.at(-1);
      if (owner !== undefined && !componentNodes.has(owner)) return;
      throw programPath.buildCodeFrameError(
        `memo-dom: [MMD-S010] '${call.callee.name}' is an HTTP ${method} server function and cannot be invoked during ${
          owner === undefined ? 'module evaluation' : 'component rendering'
        }. Move the call into an event handler, effect, or another deferred callback.`,
        call,
      );
    },
    leave(node) {
      if (RENDER_FUNCTION_TYPES.has(node.type)) functionStack.pop();
    },
  });
}

/** Register event-assigned source holders that need per-update subscriptions. */
export function scanEventSourceAssignments(ctx: Ctx): void {
  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const names = new Set<string>();
    walkAst(componentNode, {
      enter(node) {
        if (node.type !== 'AssignmentExpression') return;
        const assignment = node as unknown as t.AssignmentExpression;
        if (assignment.operator !== '=') return;
        const left = childNode(node, 'left');
        const right = childNode(node, 'right');
        if (left?.type !== 'Identifier') return;
        if (
          right === null ||
          !astFactory.isCallExpression(right as unknown as t.Node) ||
          !isCallToImported(
            ctx,
            componentNode,
            right as unknown as t.Expression,
            ctx.transparentSourceFactories,
          )
        ) {
          return;
        }
        const identifier = left as unknown as Identifier;
        const binding = astBindingAt(ctx, identifier, identifier.name);
        const ownerBinding = astBindingAt(ctx, componentNode, identifier.name);
        if (
          binding === undefined ||
          binding.kind === 'import' ||
          binding !== ownerBinding ||
          ctx.instanceState.get(component)?.has(identifier.name) !== true
        ) {
          return;
        }
        names.add(identifier.name);
      },
    });
    if (names.size === 0) continue;
    ctx.eventSourceSlots.set(component, names);
    let sources = ctx.transparentSources.get(component);
    if (sources === undefined) {
      sources = new Set();
      ctx.transparentSources.set(component, sources);
    }
    let roots = ctx.opaqueBindings.get(component);
    if (roots === undefined) {
      roots = new Set();
      ctx.opaqueBindings.set(component, roots);
    }
    for (const name of names) {
      sources.add(name);
      roots.add(name);
    }
    ctx.usesTransparentData = true;
  }
}

/** Find direct component-local source declarations and tracked aliases. */
export function scanTransparentSourceBindings(ctx: Ctx): void {
  for (const [component, componentPath] of ctx.compPaths) {
    const componentNode = componentPath.node as unknown as BaseNode;
    const sources = new Set<string>();
    const trackCandidates: Array<{
      name: string;
      argument: t.CallExpression['arguments'][number] | undefined;
    }> = [];
    for (const statement of componentPath.node.body.body) {
      if (!astFactory.isVariableDeclaration(statement)) continue;
      for (const declaration of statement.declarations) {
        if (!astFactory.isIdentifier(declaration.id)) continue;
        const init = declaration.init;
        if (!astFactory.isCallExpression(init)) continue;
        if (isCallToImported(
          ctx,
          componentNode,
          init,
          ctx.transparentSourceFactories,
        )) {
          sources.add(declaration.id.name);
          continue;
        }
        if (isCallToImported(
          ctx,
          componentNode,
          init,
          ctx.transparentTrackFactories,
        )) {
          trackCandidates.push({
            name: declaration.id.name,
            argument: init.arguments[0],
          });
        }
      }
    }

    // Imported module sources join the holder set so runtime commits can
    // push-invalidate plain gated reads in this component.
    if (ctx.transparentModuleSources.size > 0) {
      walkAst(componentNode, {
        enter(node) {
          if (node.type !== 'Identifier') return;
          const identifier = node as unknown as Identifier;
          if (!ctx.transparentModuleSources.has(identifier.name)) return;
          const binding = astBindingAt(ctx, node, identifier.name);
          if (
            binding === undefined ||
            !binding.references.includes(identifier) ||
            (binding.kind !== 'import' && !binding.scope.isProgramScope)
          ) {
            return;
          }
          sources.add(identifier.name);
        },
      });
    }

    const sourceProps = materializeTransparentPropBindings(ctx, component);
    for (const binding of sourceProps.keys()) sources.add(binding);
    if (sourceProps.size > 0) {
      ctx.transparentSourceProps.set(component, sourceProps);
      ctx.transparentPolicyParams.set(
        component,
        generatedIdentifier(ctx, 'dataPolicies'),
      );
    }
    if (sources.size === 0) continue;
    ctx.usesTransparentData = true;
    ctx.transparentSources.set(component, sources);

    const tracks = new Map<string, readonly string[]>();
    for (const candidate of trackCandidates) {
      const found = new Set<string>();
      if (
        astFactory.isIdentifier(candidate.argument) &&
        sources.has(candidate.argument.name)
      ) {
        found.add(candidate.argument.name);
      } else if (astFactory.isObjectExpression(candidate.argument)) {
        for (const property of candidate.argument.properties) {
          if (
            astFactory.isObjectProperty(property) &&
            astFactory.isIdentifier(property.value) &&
            sources.has(property.value.name)
          ) {
            found.add(property.value.name);
          }
        }
      }
      if (found.size > 0) tracks.set(candidate.name, [...found].sort());
    }
    if (tracks.size > 0) ctx.transparentTrackBindings.set(component, tracks);
  }
}
