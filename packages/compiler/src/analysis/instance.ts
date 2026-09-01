import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneAstNode,
  walkAst,
  type BaseNode,
  type Binding,
  type Identifier,
} from '../ast';
import {
  astBindingAt,
  bindingHasVisibleWrite,
  isConstObjectState,
  isStoreObject,
  memberRootName,
  type Ctx,
} from '../context';
import {
  bindingNames,
  type LocalDerivation,
} from '../components/props';
import { jsxAttributeName } from '../jsx/attributes';
import { summarizeHelper } from '../helper-summaries';
import { mdd } from '../identifiers';

interface LocalDerivationHelperSummary {
  reads: Set<string>;
  reason: string | null;
}

const FUNCTION_NODES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function cloneNode<TNode>(value: TNode): TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}

function node(value: unknown): BaseNode | null {
  return value !== null && typeof value === 'object' && 'type' in value
    ? (value as BaseNode)
    : null;
}

function childNode(parent: BaseNode, key: string): BaseNode | null {
  return node(fields(parent)[key]);
}

function childNodes(parent: BaseNode, key: string): BaseNode[] {
  const value = fields(parent)[key];
  return Array.isArray(value)
    ? value.map(node).filter((item) => item !== null)
    : [];
}

function identifierName(value: BaseNode | null): string | null {
  if (value?.type !== 'Identifier') return null;
  const name = fields(value).name;
  return typeof name === 'string' ? name : null;
}

function parentOf(ctx: Ctx, current: BaseNode): BaseNode | null {
  return ctx.astAnalysis?.parentByNode.get(current) ?? null;
}

function isWithin(ctx: Ctx, current: BaseNode, ancestor: BaseNode): boolean {
  let candidate: BaseNode | null = current;
  while (candidate !== null) {
    if (candidate === ancestor) return true;
    candidate = parentOf(ctx, candidate);
  }
  return false;
}

function variableDeclaratorFor(ctx: Ctx, binding: Binding): BaseNode | null {
  let current: BaseNode | null = binding.identifier;
  while (current !== null && current !== binding.declarationNode) {
    if (current.type === 'VariableDeclarator') return current;
    current = parentOf(ctx, current);
  }
  return null;
}

function localFunction(
  ctx: Ctx,
  component: BaseNode,
  at: BaseNode,
  name: string,
): BaseNode | null {
  const binding = astBindingAt(ctx, at, name);
  if (binding === undefined) return null;
  let candidate: BaseNode | null = null;
  if (binding.declarationNode.type === 'FunctionDeclaration') {
    candidate = binding.declarationNode;
  } else {
    const declaration = variableDeclaratorFor(ctx, binding);
    const initializer =
      declaration === null ? null : childNode(declaration, 'init');
    if (initializer !== null && FUNCTION_NODES.has(initializer.type)) {
      candidate = initializer;
    }
  }
  return candidate !== null && isWithin(ctx, candidate, component)
    ? candidate
    : null;
}

function functionParticipates(
  ctx: Ctx,
  fn: BaseNode,
  includeArguments: boolean,
): boolean {
  const parent = parentOf(ctx, fn);
  if (parent?.type !== 'CallExpression' && parent?.type !== 'NewExpression') {
    return false;
  }
  if (childNode(parent, 'callee') === fn) return true;
  return includeArguments && childNodes(parent, 'arguments').includes(fn);
}

function walkExecuted(
  ctx: Ctx,
  root: BaseNode,
  includeFunctionArguments: boolean,
  visit: (current: BaseNode) => void,
): void {
  walkAst<BaseNode>(root, {
    enter(current) {
      if (
        current !== root &&
        FUNCTION_NODES.has(current.type) &&
        !functionParticipates(ctx, current, includeFunctionArguments)
      ) {
        return false;
      }
      visit(current);
    },
  });
}

function isReferencedIdentifier(
  ctx: Ctx,
  identifier: BaseNode,
): identifier is BaseNode & { type: 'Identifier'; name: string } {
  const name = identifierName(identifier);
  if (name === null) return false;
  const binding = astBindingAt(ctx, identifier, name);
  return (
    binding === undefined ||
    binding.references.includes(identifier as unknown as Identifier)
  );
}

function mutationRoot(target: BaseNode | null): string | null {
  const name = identifierName(target);
  if (name !== null) return name;
  return target?.type === 'MemberExpression'
    ? memberRootName(target as unknown as t.MemberExpression)
    : null;
}

function summarizeLocalDerivationHelper(
  ctx: Ctx,
  component: BaseNode,
  at: BaseNode,
  name: string,
  reactiveBindings: Map<Binding, string>,
  cache: Map<BaseNode, LocalDerivationHelperSummary>,
  visiting: Set<BaseNode>,
): LocalDerivationHelperSummary | null {
  const fn = localFunction(ctx, component, at, name);
  if (fn === null) return null;
  const cached = cache.get(fn);
  if (cached !== undefined) return cached;
  if (visiting.has(fn)) {
    return {
      reads: new Set(),
      reason: `calls recursive local helper '${name}'`,
    };
  }

  const summary: LocalDerivationHelperSummary = {
    reads: new Set(),
    reason: null,
  };
  const fail = (message: string): void => {
    summary.reason ??= message;
  };
  const noteReactiveIdentifier = (current: BaseNode): void => {
    if (!isReferencedIdentifier(ctx, current)) return;
    const binding = astBindingAt(ctx, current, current.name);
    const source =
      binding === undefined ? undefined : reactiveBindings.get(binding);
    if (source !== undefined) summary.reads.add(source);
  };
  const noteReactiveMutation = (current: BaseNode, target: BaseNode | null): void => {
    const root = mutationRoot(target);
    if (root === null) return;
    const binding = astBindingAt(ctx, current, root);
    const source =
      binding === undefined ? undefined : reactiveBindings.get(binding);
    if (source !== undefined) {
      fail(`calls local helper '${name}' which writes reactive state '${source}'`);
    }
  };
  const noteCall = (call: BaseNode): void => {
    const calleeName = identifierName(childNode(call, 'callee'));
    if (calleeName === null) return;
    const local = summarizeLocalDerivationHelper(
      ctx,
      component,
      call,
      calleeName,
      reactiveBindings,
      cache,
      visiting,
    );
    if (local !== null) {
      for (const read of local.reads) summary.reads.add(read);
      if (local.reason !== null) fail(local.reason);
      return;
    }
    if (!ctx.helpers.has(calleeName) && !ctx.importedFunctions.has(calleeName)) {
      return;
    }
    const moduleSummary =
      ctx.importedFunctions.get(calleeName) ?? summarizeHelper(ctx, calleeName);
    for (const read of moduleSummary.reads) summary.reads.add(read);
    if (
      moduleSummary.writes.size !== 0 ||
      moduleSummary.boundedWrites.size !== 0
    ) {
      fail(`calls helper '${calleeName}' which writes reactive state`);
    } else if (moduleSummary.unbounded && ctx.helpers.has(calleeName)) {
      fail(`calls recursive helper '${calleeName}' which cannot be analyzed`);
    }
  };
  const inspect = (current: BaseNode): void => {
    if (current.type === 'Identifier') noteReactiveIdentifier(current);
    else if (current.type === 'AssignmentExpression') {
      noteReactiveMutation(current, childNode(current, 'left'));
    } else if (current.type === 'UpdateExpression') {
      noteReactiveMutation(current, childNode(current, 'argument'));
    } else if (current.type === 'AwaitExpression') {
      fail(`calls async local helper '${name}'`);
    } else if (current.type === 'YieldExpression') {
      fail(`calls yielding local helper '${name}'`);
    } else if (current.type === 'CallExpression') {
      noteCall(current);
    }
  };

  visiting.add(fn);
  const body = childNode(fn, 'body') ?? fn;
  walkExecuted(ctx, body, false, inspect);
  if (summary.reads.size !== 0) walkExecuted(ctx, body, true, inspect);
  visiting.delete(fn);
  cache.set(fn, summary);
  return summary;
}

/** Collect mutable or store-like bindings owned by each component instance. */
export function scanInstanceState(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const variables = new Set<string>();
    for (const statement of componentPath.node.body.body) {
      if (!astFactory.isVariableDeclaration(statement)) continue;
      if (
        statement.kind !== 'let' &&
        statement.kind !== 'var' &&
        statement.kind !== 'const'
      ) {
        continue;
      }
      for (const declaration of statement.declarations) {
        if (!astFactory.isIdentifier(declaration.id)) continue;
        const binding = astBindingAt(
          ctx,
          declaration as unknown as BaseNode,
          declaration.id.name,
        );
        if (
          ((statement.kind === 'let' || statement.kind === 'var') &&
            bindingHasVisibleWrite(ctx, binding)) ||
          isStoreObject(declaration.init) ||
          isConstObjectState(declaration.init)
        ) {
          variables.add(declaration.id.name);
        }
      }
    }
    if (variables.size > 0) ctx.instanceState.set(name, variables);
  }
}

/** Exclude JSX ref sinks from reactive instance state. */
export function excludeRefBindings(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const state = ctx.instanceState.get(name);
    if (state === undefined || state.size === 0) continue;
    const refs = new Set<string>();
    walkAst<BaseNode>(componentPath.node as unknown as BaseNode, {
      enter(current) {
        if (current.type !== 'JSXAttribute') return;
        const attribute = current as unknown as t.JSXAttribute;
        if (jsxAttributeName(attribute.name) !== 'ref') return;
        const value = childNode(current, 'value');
        if (value?.type !== 'JSXExpressionContainer') return;
        const expression = childNode(value, 'expression');
        const direct = identifierName(expression);
        if (direct !== null) {
          refs.add(direct);
          return;
        }
        if (expression?.type !== 'ArrayExpression') return;
        for (const element of childNodes(expression, 'elements')) {
          const item = identifierName(element);
          if (item !== null) refs.add(item);
        }
      },
    });
    for (const ref of refs) state.delete(ref);
  }
}

/** Discover ordered component-local const derivations. */
export function scanInstanceDerivations(ctx: Ctx): void {
  for (const [componentName, componentPath] of ctx.compPaths) {
    const component = componentPath.node as unknown as BaseNode;
    const reactiveBindings = new Map<Binding, string>();
    const opaqueRoots = ctx.opaqueBindings.get(componentName);
    const ownerBinding = (name: string): Binding | undefined =>
      astBindingAt(ctx, component, name);
    const isOpaqueLocal = (name: string, at: BaseNode): boolean => {
      if (opaqueRoots?.has(name) !== true) return false;
      const binding = astBindingAt(ctx, at, name);
      return binding !== undefined && binding === ownerBinding(name);
    };
    const isTransparentLocal = (name: string, at: BaseNode): boolean => {
      if (ctx.transparentSources.get(componentName)?.has(name) !== true) {
        return false;
      }
      const binding = astBindingAt(ctx, at, name);
      return binding !== undefined && binding === ownerBinding(name);
    };

    for (const name of ctx.componentProps.get(componentName)?.bindings ?? []) {
      const binding = ownerBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(componentName) ?? []) {
      const binding = ownerBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = ownerBinding(name);
      if (binding?.scope.isProgramScope === true) {
        reactiveBindings.set(binding, name);
      }
    }

    const derivations: LocalDerivation[] = [];
    const derivedBindings = new Set<string>();
    const derivedSources = new Map<string, Set<string>>();

    const isTransparentFetchCall = (initializer: BaseNode): boolean => {
      if (initializer.type !== 'CallExpression') return false;
      const calleeName = identifierName(childNode(initializer, 'callee'));
      if (
        calleeName === null ||
        !ctx.transparentSourceFactories.has(calleeName)
      ) {
        return false;
      }
      return astBindingAt(ctx, initializer, calleeName)?.kind === 'import';
    };

    const opaqueUseIsLiveRead = (start: BaseNode): boolean => {
      let current = start;
      let climbed = false;
      for (;;) {
        const parent = parentOf(ctx, current);
        if (
          (parent?.type === 'MemberExpression' ||
            parent?.type === 'OptionalMemberExpression') &&
          childNode(parent, 'object') === current
        ) {
          current = parent;
          climbed = true;
          continue;
        }
        break;
      }
      if (!climbed) return false;
      const user = parentOf(ctx, current);
      if (user !== null) {
        if (
          (user.type === 'CallExpression' || user.type === 'NewExpression') &&
          childNode(user, 'callee') === current
        ) {
          return isTransparentLocal(identifierName(start)!, start);
        }
        if (
          user.type === 'CallExpression' ||
          user.type === 'NewExpression' ||
          user.type === 'SpreadElement'
        ) {
          return false;
        }
        if (
          user.type === 'AssignmentExpression' &&
          childNode(user, 'left') === current
        ) {
          return false;
        }
      }
      return true;
    };

    const classifyOpaqueReads = (
      initializer: BaseNode,
    ): 'none' | 'ok' | 'bad' => {
      let verdict: 'none' | 'ok' | 'bad' = 'none';
      walkExecuted(ctx, initializer, true, (current) => {
        if (verdict === 'bad' || !isReferencedIdentifier(ctx, current)) return;
        const binding = astBindingAt(ctx, current, current.name);
        if (binding !== undefined && reactiveBindings.has(binding)) return;
        if (!isOpaqueLocal(current.name, current)) return;
        verdict = opaqueUseIsLiveRead(current) ? 'ok' : 'bad';
      });
      return verdict;
    };

    for (const statement of componentPath.node.body.body) {
      if (!astFactory.isVariableDeclaration(statement)) continue;
      for (const declaration of statement.declarations) {
        if (
          (!astFactory.isIdentifier(declaration.id) &&
            !astFactory.isObjectPattern(declaration.id) &&
            !astFactory.isArrayPattern(declaration.id)) ||
          declaration.init == null ||
          astFactory.isFunction(declaration.init)
        ) {
          continue;
        }
        if (
          astFactory.isIdentifier(declaration.id) &&
          ctx.instanceState
            .get(componentName)
            ?.has(declaration.id.name) === true &&
          (isStoreObject(declaration.init) ||
            isConstObjectState(declaration.init))
        ) {
          continue;
        }
        const initializer = declaration.init as unknown as BaseNode;
        const isTransparentFetch = isTransparentFetchCall(initializer);
        if (classifyOpaqueReads(initializer) === 'bad') continue;

        const directReads = new Set<string>();
        let reason: string | null = null;
        const bindingIsReactive = (name: string, at: BaseNode): boolean => {
          const binding = astBindingAt(ctx, at, name);
          return binding !== undefined && reactiveBindings.has(binding);
        };
        const noteIdentifier = (current: BaseNode): void => {
          if (!isReferencedIdentifier(ctx, current)) return;
          const binding = astBindingAt(ctx, current, current.name);
          const source =
            binding === undefined ? undefined : reactiveBindings.get(binding);
          if (source !== undefined) directReads.add(source);
          else if (isOpaqueLocal(current.name, current)) {
            directReads.add(current.name);
          }
        };
        const helperCache = new Map<BaseNode, LocalDerivationHelperSummary>();
        const helperVisiting = new Set<BaseNode>();
        const noteCall = (call: BaseNode): void => {
          const calleeName = identifierName(childNode(call, 'callee'));
          if (calleeName === null) return;
          const local = summarizeLocalDerivationHelper(
            ctx,
            component,
            call,
            calleeName,
            reactiveBindings,
            helperCache,
            helperVisiting,
          );
          if (local !== null) {
            for (const read of local.reads) directReads.add(read);
            reason ??= local.reason;
            return;
          }
          if (
            !ctx.helpers.has(calleeName) &&
            !ctx.importedFunctions.has(calleeName)
          ) {
            return;
          }
          const summary =
            ctx.importedFunctions.get(calleeName) ??
            summarizeHelper(ctx, calleeName);
          for (const read of summary.reads) directReads.add(read);
          if (
            summary.writes.size !== 0 ||
            summary.boundedWrites.size !== 0
          ) {
            reason ??= `calls helper '${calleeName}' which writes reactive state`;
          } else if (summary.unbounded && ctx.helpers.has(calleeName)) {
            reason ??= `calls recursive helper '${calleeName}' which cannot be analyzed`;
          }
        };
        const inspect = (current: BaseNode): void => {
          if (current.type === 'Identifier') noteIdentifier(current);
          else if (current.type === 'AssignmentExpression') {
            const root = mutationRoot(childNode(current, 'left'));
            if (root !== null && bindingIsReactive(root, current)) {
              reason = 'contains an assignment to reactive state';
            }
          } else if (current.type === 'UpdateExpression') {
            const root = mutationRoot(childNode(current, 'argument'));
            if (root !== null && bindingIsReactive(root, current)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          } else if (current.type === 'AwaitExpression') {
            reason = 'uses await; per-instance derivations must be synchronous';
          } else if (current.type === 'YieldExpression') {
            reason = 'uses yield; per-instance derivations must be synchronous';
          } else if (current.type === 'CallExpression') {
            noteCall(current);
          }
        };

        walkExecuted(ctx, initializer, false, inspect);
        if (directReads.size === 0) continue;
        walkExecuted(ctx, initializer, true, inspect);
        if (statement.kind !== 'const') {
          const names = bindingNames(declaration.id);
          const bindings = names.map((name) => ownerBinding(name));
          if (
            bindings.length > 0 &&
            bindings.every(
              (binding) =>
                binding !== undefined && binding.constantViolations.length === 0,
            )
          ) {
            throw componentPath.buildCodeFrameError(
              `memo-dom: ${statement.kind} '${
                names.join(', ') || '<pattern>'
              }' is never reassigned and its initializer reads reactive state; use const for derived values`,
              declaration,
            );
          }
          continue;
        }
        if (reason !== null) {
          const names = bindingNames(declaration.id);
          throw componentPath.buildCodeFrameError(
            `memo-dom: local const '${
              names.join(', ') || '<pattern>'
            }' is a per-instance derivation but ${reason}`,
          );
        }

        const names = bindingNames(declaration.id);
        const sources = new Set<string>();
        for (const read of directReads) {
          const upstream = derivedSources.get(read);
          if (upstream === undefined) sources.add(read);
          else for (const source of upstream) sources.add(source);
        }
        const stableFetchTarget =
          isTransparentFetch && astFactory.isIdentifier(declaration.id);
        const replay = stableFetchTarget && astFactory.isCallExpression(declaration.init)
          ? astFactory.expressionStatement(
              astFactory.callExpression(mdd(ctx, 'rebindResolvedValue'), [
                astFactory.identifier((declaration.id as t.Identifier).name),
                ...declaration.init.arguments.map(cloneNode),
              ]),
            )
          : undefined;
        derivations.push({
          declaration: statement,
          target: cloneNode(declaration.id),
          source: cloneNode(declaration.init),
          bindings: names,
          sources: [...sources].sort(),
          ...(stableFetchTarget ? { stableTarget: true, replay } : {}),
        });
        if (stableFetchTarget) continue;
        for (const name of names) {
          derivedBindings.add(name);
          derivedSources.set(name, new Set(sources));
          const binding = ownerBinding(name);
          if (binding) reactiveBindings.set(binding, name);
          ctx.instanceState.get(componentName)?.delete(name);
        }
      }
    }

    if (derivations.length === 0) continue;
    ctx.instanceDerivations.set(componentName, derivations);
    ctx.instanceDerivedBindings.set(componentName, derivedBindings);
    const exactSources = new Set<string>([
      ...(ctx.instanceState.get(componentName) ?? []),
      ...(ctx.componentProps.get(componentName)?.bindings ?? []),
    ]);
    const selective = [...exactSources].some((source) =>
      derivations.some((derivation) => !derivation.sources.includes(source)),
    );
    if (!selective) continue;
    const reasonSources = new Set<string>([
      ...exactSources,
      ...derivations.flatMap((derivation) => derivation.sources),
    ]);
    ctx.instanceReasonIds.set(
      componentName,
      new Map(
        [...reasonSources].sort().map((source, index) => [source, index]),
      ),
    );
    ctx.selectiveDerivationComponents.add(componentName);
  }
}
