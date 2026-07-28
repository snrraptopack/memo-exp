import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  isConstObjectState,
  isStoreObject,
  memberRootName,
  type Ctx,
} from '../context';
import {
  bindingNames,
  type LocalDerivation,
} from '../components/props';

/** Collect mutable or store-like bindings owned by each component instance. */
export function scanInstanceState(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const variables = new Set<string>();
    for (const statement of componentPath.node.body.body) {
      if (!t.isVariableDeclaration(statement)) continue;
      if (
        statement.kind !== 'let' &&
        statement.kind !== 'var' &&
        statement.kind !== 'const'
      ) {
        continue;
      }
      for (const declaration of statement.declarations) {
        if (!t.isIdentifier(declaration.id)) continue;
        if (
          statement.kind === 'let' ||
          statement.kind === 'var' ||
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

/**
 * Discover ordered component-local const derivations. These replay in the
 * owning component update before guarded DOM setters.
 */
export function scanInstanceDerivations(ctx: Ctx): void {
  for (const [componentName, componentPath] of ctx.compPaths) {
    const reactiveBindings = new Map<unknown, string>();

    for (const name of ctx.componentProps.get(componentName)?.bindings ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(componentName) ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = componentPath.scope.getBinding(name);
      if (binding?.scope.path.isProgram()) {
        reactiveBindings.set(binding, name);
      }
    }

    const derivations: LocalDerivation[] = [];
    const derivedBindings = new Set<string>();
    const derivedSources = new Map<string, Set<string>>();
    const statements = componentPath.get('body').get('body');
    for (const statementPath of statements) {
      if (!statementPath.isVariableDeclaration({ kind: 'const' })) continue;
      for (const declarationPath of statementPath.get('declarations')) {
        const declaration = declarationPath.node;
        if (
          (!t.isIdentifier(declaration.id) &&
            !t.isObjectPattern(declaration.id) &&
            !t.isArrayPattern(declaration.id)) ||
          declaration.init == null ||
          t.isFunction(declaration.init)
        ) {
          continue;
        }
        if (
          t.isIdentifier(declaration.id) &&
          ctx.instanceState
            .get(componentName)
            ?.has(declaration.id.name) === true &&
          (isStoreObject(declaration.init) ||
            isConstObjectState(declaration.init))
        ) {
          continue;
        }
        const initPath = declarationPath.get('init');
        if (!initPath.isExpression()) continue;

        const directReads = new Set<string>();
        let reason: string | null = null;
        const bindingIsReactive = (name: string, at: NodePath): boolean => {
          const binding = at.scope.getBinding(name);
          return binding !== undefined && reactiveBindings.has(binding);
        };
        const noteIdentifier = (path: NodePath): void => {
          if (!t.isIdentifier(path.node)) return;
          const binding = path.scope.getBinding(path.node.name);
          const source =
            binding === undefined ? undefined : reactiveBindings.get(binding);
          if (source !== undefined) directReads.add(source);
        };
        const mutationRoot = (node: t.Node): string | null =>
          t.isIdentifier(node)
            ? node.name
            : t.isMemberExpression(node)
              ? memberRootName(node)
              : null;

        if (initPath.isReferencedIdentifier()) noteIdentifier(initPath);
        if (initPath.isAssignmentExpression()) {
          const root = mutationRoot(initPath.node.left);
          if (root !== null && bindingIsReactive(root, initPath)) {
            reason = 'contains an assignment to reactive state';
          }
        } else if (initPath.isUpdateExpression()) {
          const root = mutationRoot(initPath.node.argument);
          if (root !== null && bindingIsReactive(root, initPath)) {
            reason = 'contains an update (++/--) to reactive state';
          }
        } else if (initPath.isAwaitExpression()) {
          reason = 'uses await; per-instance derivations must be synchronous';
        } else if (initPath.isYieldExpression()) {
          reason = 'uses yield; per-instance derivations must be synchronous';
        }
        initPath.traverse({
          Function(functionPath) {
            functionPath.skip();
          },
          ReferencedIdentifier(path) {
            noteIdentifier(path);
          },
          AssignmentExpression(path) {
            const root = mutationRoot(path.node.left);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an assignment to reactive state';
            }
          },
          UpdateExpression(path) {
            const root = mutationRoot(path.node.argument);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          },
          AwaitExpression() {
            reason = 'uses await; per-instance derivations must be synchronous';
          },
          YieldExpression() {
            reason = 'uses yield; per-instance derivations must be synchronous';
          },
        });

        if (directReads.size === 0) continue;
        initPath.traverse({
          ReferencedIdentifier(path) {
            noteIdentifier(path);
          },
          AssignmentExpression(path) {
            const root = mutationRoot(path.node.left);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an assignment to reactive state';
            }
          },
          UpdateExpression(path) {
            const root = mutationRoot(path.node.argument);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          },
        });
        if (reason !== null) {
          const names = bindingNames(declaration.id);
          throw declarationPath.buildCodeFrameError(
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
        derivations.push({
          declaration: statementPath.node,
          target: t.cloneNode(declaration.id),
          source: t.cloneNode(declaration.init),
          bindings: names,
          sources: [...sources].sort(),
        });
        for (const name of names) {
          derivedBindings.add(name);
          derivedSources.set(name, new Set(sources));
          const binding = componentPath.scope.getBinding(name);
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
      derivations.some(
        (derivation) => !derivation.sources.includes(source),
      ),
    );
    if (!selective) continue;
    const reasonSources = new Set<string>([
      ...exactSources,
      ...derivations.flatMap((derivation) => derivation.sources),
    ]);
    ctx.instanceReasonIds.set(
      componentName,
      new Map(
        [...reasonSources]
          .sort()
          .map((source, index) => [source, index]),
      ),
    );
    ctx.selectiveDerivationComponents.add(componentName);
  }
}
